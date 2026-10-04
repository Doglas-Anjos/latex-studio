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
// pandoc and texcount follow \input-like commands without kpathsea's paranoid mode, so a project
// could pull /proc/self/environ or another project's files into the exported document.
const UNSAFE_INCLUDE =
  /\\(input|include|includegraphics|lstinputlisting|verbatiminput|InputIfFileExists|bibliography|addbibresource|import|subfile|includeonly)\s*(\[[^\]]*\])?\s*\{\s*(\/|[A-Za-z]:|\.\.|~)/;

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
    if (UNSAFE_INCLUDE.test(await readFile(join(dir, file), 'utf8'))) {
      throw new Error(`${file}: absolute or parent paths in input-like commands are not allowed`);
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
async function formatText(path: string, text: string): Promise<{ text: string }> {
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
    return { text: stdout };
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
    if (job.data.kind === 'format') return formatText(job.data.path, job.data.text);
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
      await pruneOld(dir);
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

/** Export files are one-shot downloads; drop anything older than an hour. */
async function pruneOld(dir: string): Promise<void> {
  for (const name of await readdir(dir)) {
    const path = join(dir, name);
    if (Date.now() - (await stat(path)).mtimeMs > EXPORT_TTL_MS) await unlink(path);
  }
}
