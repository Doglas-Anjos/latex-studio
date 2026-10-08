import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
  APP_CONFIG,
  DATABASE,
  type Database,
  eq,
  SafePath,
  TOOLS_QUEUE,
  type ToolJobData,
  type WorkerConfig,
} from '@latex-studio/core';
import { projects } from '@latex-studio/core/schema';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject } from '@nestjs/common';
import type { Job } from 'bullmq';
import { snapshotProject } from '../snapshot';

const run = promisify(execFile);
const MAX_STDERR = 2048;
const EXPORT_TTL_MS = 60 * 60 * 1000;
const FORMAT_TTL_MS = 10 * 60 * 1000;
const MAX_SCAN_BYTES = 1024 * 1024;
// pandoc and texcount follow \input-like commands without kpathsea's paranoid mode, so a project
// could pull /proc/self/environ or another project's files into the exported document.
// An include command with no literal path after it (`\let\x\input`, `\def\x{\input}`,
// `\expandafter\input\csname`) is refused: it is how an alias would smuggle a path past the scan.
// ponytail: still lexical (a path built by macros can get through); the real fix is running
// pandoc/texcount with no read access outside the snapshot (an OS sandbox).
const INCLUDE_CMD =
  /\\(@{0,2}input|include|includegraphics|lstinputlisting|verbatiminput|inputminted|InputIfFileExists|bibliography|addbibresource|import|subimport|subfile|includeonly|includepdf)(?![A-Za-z])/g;
const CSNAME_INCLUDE =
  /\\csname\s{0,64}@{0,2}(input|include|import|subimport|subfile|InputIfFileExists)\s{0,64}\\endcsname/;
const TWO_PATH_ARGS = new Set(['import', 'subimport', 'inputminted']); // {dir}{file}, {lang}{file}
const OPT_ARG = /[\s*]{0,64}\[[^\][]{0,1024}\]/y;
const OPEN_ARG = /[\s*]{0,64}\{/y;
const BARE_ARG = /\s{0,64}([^\s{}[\]\\%]{1,1024})/y;
const MAX_ARG = 1024;

/** Absolute, `~`, a `..` segment, a pipe, or a backslash (Windows separator or an unknown macro). */
const unsafePath = (arg: string): boolean =>
  arg
    .replace(/[{}"]/g, '') // TeX drops grouping braces, pandoc drops quotes
    .split(',') // \bibliography{a,b}, \includeonly{a,b}
    .some((p) => /^\s*([/~]|[A-Za-z]:)|[\\|]|(^|\/)\s*\.\.\s*(\/|$)/.test(p));

/** End of the brace group opened just before `from`, or -1 if it is unbalanced or too long. */
function closeBrace(text: string, from: number): number {
  for (let i = from, depth = 1; i < text.length && i < from + MAX_ARG; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}' && --depth === 0) return i;
  }
  return -1;
}

/** The first include-like command whose path argument could leave the project, if any. */
const VERB = /\\verb\*?([^\sA-Za-z*])[^\n]{0,200}?\1/g;
const COMMENT = /(?<!\\)%[^\n]*/g;
const VERBATIM_BEGIN = /\\begin\{(verbatim|lstlisting|minted)(\*?)\}/g;

/**
 * Drops what pandoc and texcount read as literal text (comments, `\verb|...|`, verbatim blocks),
 * so a document that writes about `\input` is not mistaken for one that uses it. Linear: each
 * block end is searched once, and an unclosed block stops the search.
 */
function dropLiterals(text: string): string {
  let out = text.replace(VERB, ' ').replace(COMMENT, '');
  VERBATIM_BEGIN.lastIndex = 0;
  for (let m = VERBATIM_BEGIN.exec(out); m; m = VERBATIM_BEGIN.exec(out)) {
    const close = `\\end{${m[1]}${m[2]}}`;
    const end = out.indexOf(close, VERBATIM_BEGIN.lastIndex);
    if (end < 0) break;
    out = `${out.slice(0, m.index)} ${out.slice(end + close.length)}`;
    VERBATIM_BEGIN.lastIndex = m.index + 1;
  }
  return out;
}

export function findUnsafeInclude(source: string): string | undefined {
  const text = dropLiterals(source);
  for (const m of text.matchAll(INCLUDE_CMD)) {
    let pos = m.index + m[0].length;
    let args = 0;
    for (let guard = 0; guard < 8 && args < (TWO_PATH_ARGS.has(m[1] as string) ? 2 : 1); guard++) {
      OPT_ARG.lastIndex = pos;
      if (OPT_ARG.test(text)) {
        pos = OPT_ARG.lastIndex;
        continue;
      }
      OPEN_ARG.lastIndex = pos;
      if (!OPEN_ARG.test(text)) break;
      const end = closeBrace(text, OPEN_ARG.lastIndex);
      if (end < 0 || unsafePath(text.slice(OPEN_ARG.lastIndex, end))) return m[0];
      pos = end + 1;
      args++;
    }
    if (args > 0) continue;
    BARE_ARG.lastIndex = pos; // TeX's `\input file`
    const bare = BARE_ARG.exec(text)?.[1];
    if (!bare || unsafePath(bare)) return m[0];
  }
  return CSNAME_INCLUDE.exec(text)?.[0];
}

/** All files under `dir`, as `/`-separated paths relative to it. */
async function listTree(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((e) => e.isFile())
    .map((e) =>
      join(e.parentPath, e.name)
        .slice(dir.length + 1)
        .replaceAll('\\', '/'),
    );
}

export async function assertNoUnsafeIncludes(dir: string, files: string[]): Promise<void> {
  for (const file of files.filter((f) => /\.(tex|sty|cls|bib)$/i.test(f))) {
    // Unscanned files must not reach pandoc/texcount, so a big one fails the job.
    if ((await stat(join(dir, file))).size > MAX_SCAN_BYTES) {
      throw new Error(`${file}: too large to check for unsafe includes (max 1 MB)`);
    }
    const cmd = findUnsafeInclude(await readFile(join(dir, file), 'utf8'));
    if (cmd) {
      throw new Error(`${file}: absolute or parent paths in ${cmd} are not allowed`);
    }
  }
}

export interface WordCount {
  words: number;
  headers: number;
  captions: number;
  raw: string;
}

/** Parses `texcount -brief`: `N+M+K (H/C/I/D) Total`; if it does not match only `raw` is kept. */
export function parseTexcount(raw: string): WordCount | { raw: string } {
  const m = /^(\d+)\+(\d+)\+(\d+)\b/m.exec(raw);
  if (!m) return { raw };
  return { words: Number(m[1]), headers: Number(m[2]), captions: Number(m[3]), raw };
}

const FORMATTABLE = /\.(tex|sty|cls|bib)$/i;
const MAX_FORMAT_BYTES = 1024 * 1024;

/**
 * `latexindent` to stdout (no `-w`, the snapshot is never written back). No `-l`: without it
 * latexindent ignores localSettings.yaml/.latexindent.yaml in the project (`-l=` would load them),
 * and HOME is an empty dir, so no indentconfig.yaml either. indent.log lands next to the file.
 */
/**
 * Formats the submitted text (the live editor content, not the disk snapshot, which lags the
 * editor by seconds) in a throwaway dir: `in.<ext>` is the only file latexindent sees.
 * Memory is bounded by the container limit, like compile.
 */
async function formatText(path: string, text: string): Promise<string> {
  const ext = FORMATTABLE.exec(path)?.[1]?.toLowerCase();
  if (!ext) throw new Error(`Invalid path: ${path}`);
  if (Buffer.byteLength(text) > MAX_FORMAT_BYTES) {
    throw new Error('File too large to format (max 1 MB)');
  }
  const dir = await mkdtemp(join(tmpdir(), 'ls-fmt-'));
  try {
    const name = `in.${ext}`;
    await writeFile(join(dir, name), text);
    const args = ["-y=defaultIndent: '  '", '-g=indent.log', name];
    const { stdout } = await run('latexindent', args, {
      cwd: dir,
      windowsHide: true,
      maxBuffer: 2 * MAX_FORMAT_BYTES,
      env: { PATH: process.env.PATH, HOME: dir },
      timeout: 15_000,
    }).catch((e: { stderr?: string; message: string }) => {
      const lines = (e.stderr || e.message).split('\n').slice(0, 5).join('\n');
      throw new Error(lines.replace(/[^\t\n\x20-\x7e]/g, '').slice(0, 500));
    });
    return stdout;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const fail = (e: unknown): never => {
  const err = e as { stderr?: string; message: string };
  throw new Error((err.stderr || err.message).slice(0, MAX_STDERR));
};

@Processor(TOOLS_QUEUE, { concurrency: 1 })
export class ToolsProcessor extends WorkerHost {
  private readonly builds: SafePath;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: WorkerConfig,
  ) {
    super();
    this.builds = new SafePath(config.BUILDS_DIR);
  }

  async process(job: Job<ToolJobData>): Promise<unknown> {
    if (job.data.kind === 'format') {
      // Up to 1 MB: a return value would be copied into Redis (job hash and events stream), so
      // it goes to disk and the API reads it back when the client polls the job.
      const text = await formatText(job.data.path, job.data.text);
      const dir = this.builds.resolve(`${job.data.projectId}/format`);
      await mkdir(dir, { recursive: true });
      await pruneOld(dir, FORMAT_TTL_MS);
      const file = `${job.id}.txt`;
      await writeFile(join(dir, file), text);
      return { file };
    }
    const { projectId } = job.data;
    const [project] = await this.db.select().from(projects).where(eq(projects.id, projectId));
    if (!project) throw new Error('Project not found');
    const home = await mkdtemp(join(tmpdir(), 'ls-home-'));
    const tmp = await snapshotProject(this.config.REPOS_DIR, projectId);
    const options = {
      cwd: tmp,
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
      env: { PATH: process.env.PATH, HOME: home },
    };
    try {
      new SafePath(tmp).resolve(project.mainFile); // throws on `..`, absolute or odd names
      if (project.mainFile.startsWith('-')) throw new Error('Invalid main file');
      const files = await listTree(tmp);
      await assertNoUnsafeIncludes(tmp, files);
      if (job.data.kind === 'wordcount') {
        const args = ['-total', '-brief', '-nosub', '-inc', '-merge', project.mainFile];
        const { stdout } = await run('texcount', args, { ...options, timeout: 60_000 }).catch(fail);
        return parseTexcount(stdout);
      }
      const { format } = job.data;
      const dir = this.builds.resolve(`${projectId}/exports`);
      await mkdir(dir, { recursive: true });
      await pruneOld(dir, EXPORT_TTL_MS);
      const file = `${job.id}.${format}`;
      const bib = files.find((f) => f.endsWith('.bib'));
      const args = [
        '-s',
        project.mainFile,
        '-o',
        join(dir, file),
        '--citeproc',
        ...(bib ? ['--bibliography', bib] : []),
        '--resource-path',
        tmp,
      ];
      await run('pandoc', args, { ...options, timeout: 120_000 }).catch(fail);
      return { file };
    } finally {
      await rm(tmp, { recursive: true, force: true });
      await rm(home, { recursive: true, force: true });
    }
  }
}

/** Export and format files are one-shot downloads; drop anything older than `ttl`. */
async function pruneOld(dir: string, ttl: number): Promise<void> {
  for (const name of await readdir(dir)) {
    const path = join(dir, name);
    if (Date.now() - (await stat(path)).mtimeMs > ttl) await unlink(path);
  }
}
