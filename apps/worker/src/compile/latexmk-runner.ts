import { type ChildProcess, execFile, spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, extname, join } from 'node:path';
import { APP_CONFIG, type WorkerConfig } from '@latex-studio/core';
import { Inject, Injectable } from '@nestjs/common';
import { Sandbox } from './sandbox';

export type Engine = 'pdflatex' | 'xelatex' | 'lualatex';

export interface LatexmkResult {
  exitCode: number;
  timedOut: boolean;
  cancelled: boolean;
}

const ENGINE_FLAGS: Record<Engine, string[]> = {
  pdflatex: ['-pdf'],
  xelatex: ['-pdfxe'],
  // No `--safer`: luaotfload (so fontspec, i.e. nearly every LuaLaTeX document) refuses to run
  // under it. Without it, Lua's io.input/io.output and os.getenv are NOT fenced by kpathsea's
  // paranoid mode, so the compile processor refuses this engine unless COMPILE_ALLOW_LUALATEX.
  lualatex: ['-pdflua'],
};
const WINDOWS = process.platform === 'win32';
/** Written into the throwaway snapshot only; never part of the project. */
const DRAFT_WRAPPER = 'latex-studio-draft.tex';
/**
 * latexmk passes every command (pdflatex, bibtex, biber, makeindex) and every kpsewhich lookup to
 * /bin/sh as one string, with file names it read from the .aux/.log/.fls wrapped in "..." — and
 * the document controls those names. This `-e` code swaps its two shell sinks (`Run` and
 * `kpsewhich`) for list-form calls that split the string the same way (latexmk's own
 * parse_quotes) but never start a shell. It stops the run if a latexmk upgrade renames them.
 * No quotes or backslashes in it: MiKTeX's latexmk wrapper mangles them on the command line.
 */
export const NO_SHELL =
  'no warnings q(redefine); ' +
  'defined &Run && defined &kpsewhich && defined &parse_quotes or die q(latexmk internals changed); ' +
  '*Run = sub { my @a = parse_quotes($_[0]); (0, system { $a[0] } @a) }; ' +
  '*kpsewhich = sub { open(my $f, q(-|), q(kpsewhich), @_) or return (); chomp(my @l = <$f>); @l };';

/**
 * Runs latexmk without a shell, with a wall-clock timeout and a minimal environment.
 *
 * Per-compile memory is capped with `prlimit --as` (COMPILE_MEMORY_MB), inherited by every TeX
 * child; pids are bounded by the container `pids_limit`. prlimit is Linux-only, so dev on
 * Windows/macOS skips it (the container is the only place it matters). File isolation rests on the
 * bwrap sandbox when available, else on kpathsea's paranoid mode (pdfTeX, XeTeX).
 *
 * `spawn` (argument array, no shell) instead of `execFile`: execFile's timeout only kills
 * latexmk, leaving pdflatex running (e.g. `\def\a{\a}\a` loops forever). Here latexmk leads its
 * own process group and the timeout kills the whole group.
 */
@Injectable()
export class LatexmkRunner {
  constructor(
    @Inject(APP_CONFIG) private readonly config: WorkerConfig,
    @Inject(Sandbox) private readonly sandbox: Sandbox,
  ) {}

  async run(job: {
    workDir: string;
    engine: Engine;
    mainFile: string;
    options?: { draft?: boolean; haltOnError?: boolean } | undefined;
    /** Aborting kills the whole process group (user pressed "stop"). */
    signal?: AbortSignal | undefined;
  }): Promise<LatexmkResult> {
    const { workDir, engine, mainFile, options = {}, signal } = job;
    // A main file named like an option would be parsed as one.
    if (mainFile.startsWith('-')) throw new Error(`Invalid main file: ${mainFile}`);
    // Draft ("fast"): images as frames, like Overleaf. The TeX goes in a one-line wrapper file
    // rather than `-usepretex`, whose backslashes MiKTeX's latexmk strips from the command line.
    // `-jobname` keeps every output named after the real main file.
    let target = mainFile;
    if (options.draft) {
      target = DRAFT_WRAPPER;
      await writeFile(
        join(workDir, DRAFT_WRAPPER),
        `\\PassOptionsToPackage{draft}{graphicx}\\input{${mainFile}}\n`,
      );
    }
    const args = [
      ...ENGINE_FLAGS[engine],
      // A project-supplied .latexmkrc would run as Perl inside the worker.
      '-norc',
      '-e',
      NO_SHELL,
      '-interaction=nonstopmode',
      // "Try to compile despite errors" (Overleaf's default): -f makes latexmk run every pass even
      // when one exits non-zero, so a document whose first pass errors still yields a PDF — e.g.
      // glossaries/acronym forward references, which only resolve on the second pass via .glsdefs.
      // Without -f, latexmk aborts on the first failing pass and never reaches that second pass.
      ...(options.haltOnError === false ? ['-f'] : ['-halt-on-error']),
      ...(options.draft ? [`-jobname=${basename(mainFile, extname(mainFile))}`] : []),
      '-no-shell-escape',
      // MiKTeX ignores the max_print_line env var below; without this its log wraps at 79
      // columns (MiKTeX's lualatex rejects the flag) and `C:\...\pkg.sty:10: Fatal ...` errors split across lines unparsed.
      ...(WINDOWS && engine !== 'lualatex' ? ['-latexoption=-max-print-line=10000'] : []),
      '-file-line-error',
      '-synctex=1',
      '-output-directory=out',
      target,
    ];
    // HOME and the per-user texmf trees live outside the snapshot, so project files can never be
    // picked up as a format, Lua bytecode cache or fontconfig. In the sandbox HOME is the private
    // tmpfs, so there is no host directory to make or clean up.
    const sandboxed = this.sandbox.enabled;
    const home = sandboxed ? '/tmp' : await mkdtemp(join(tmpdir(), 'ls-home-'));
    const env = {
      PATH: process.env.PATH,
      HOME: home,
      // TeX Live honours these (MiKTeX ignores them): nothing is read from or written to a
      // shared texmf tree, and kpathsea refuses absolute and `..` paths (paranoid mode).
      TEXMFVAR: join(home, 'texmf-var'),
      TEXMFCONFIG: join(home, 'texmf-config'),
      TEXMFHOME: join(home, 'texmf-home'),
      openin_any: 'p',
      openout_any: 'p',
      shell_escape: 'f',
      max_print_line: '10000',
    };

    const spec = this.sandbox.spawn('latexmk', args, workDir, env);
    // ponytail: RLIMIT_AS (virtual memory), not RSS — a huge LuaLaTeX document may need
    // COMPILE_MEMORY_MB raised. Upgrade path: a per-compile cgroup if that bites.
    const limited = withMemoryLimit(spec.file, spec.args, this.config.COMPILE_MEMORY_MB);
    try {
      return await new Promise((resolve, reject) => {
        const child = spawn(limited.file, limited.args, {
          cwd: workDir,
          env: spec.env,
          windowsHide: true,
          detached: !WINDOWS,
          stdio: 'ignore',
        });
        let timedOut = false;
        let cancelled = false;
        const timer = setTimeout(() => {
          timedOut = true;
          killTree(child);
        }, this.config.COMPILE_TIMEOUT_MS);
        const onAbort = () => {
          cancelled = true;
          killTree(child);
        };
        signal?.addEventListener('abort', onAbort, { once: true });
        if (signal?.aborted) onAbort();
        child.on('error', (error) => {
          clearTimeout(timer);
          signal?.removeEventListener('abort', onAbort);
          reject(error);
        });
        child.on('close', (code) => {
          clearTimeout(timer);
          signal?.removeEventListener('abort', onAbort);
          resolve({ exitCode: code ?? -1, timedOut, cancelled });
        });
      });
    } finally {
      if (!sandboxed) await rm(home, { recursive: true, force: true });
    }
  }
}

/**
 * Wraps the command in `prlimit --as=<bytes>` so latexmk and every TeX child share one address-space
 * cap (COMPILE_MEMORY_MB). Linux only; prlimit does not exist on Windows/macOS dev, so there the
 * command runs unwrapped. prlimit itself is found via PATH, like the wrapped command.
 */
export function withMemoryLimit(
  file: string,
  args: string[],
  memoryMb: number | undefined,
  isLinux = process.platform === 'linux',
): { file: string; args: string[] } {
  if (!isLinux || !memoryMb) return { file, args };
  return { file: 'prlimit', args: [`--as=${memoryMb * 1024 * 1024}`, '--', file, ...args] };
}

function killTree(child: ChildProcess): void {
  if (child.pid === undefined) return;
  if (WINDOWS) {
    // ponytail: dev only (production runs the Linux container). MiKTeX's pdflatex is reparented
    // away from latexmk, so /T misses it and a looping compile survives; fix would be a Job object.
    execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {});
  } else {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      // already gone
    }
  }
}
