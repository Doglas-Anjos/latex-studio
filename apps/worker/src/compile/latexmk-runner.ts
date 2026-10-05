import { type ChildProcess, execFile, spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { APP_CONFIG, type WorkerConfig } from '@latex-studio/core';
import { Inject, Injectable } from '@nestjs/common';

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
  // under it. Lua's io/os are still fenced by shell_escape=f and kpathsea's paranoid
  // openin_any/openout_any (both honoured by LuaTeX), plus the container limits.
  lualatex: ['-pdflua'],
};
const WINDOWS = process.platform === 'win32';

/**
 * Runs latexmk without a shell, with a wall-clock timeout and a minimal environment.
 *
 * Memory, pids and network are limited by the worker container (`mem_limit`, `pids_limit`,
 * `network_mode: none`), not here: there is no portable per-process memory cap without a shell
 * `ulimit`, so COMPILE_MEMORY_MB is enforced by docker-compose.
 *
 * `spawn` (argument array, no shell) instead of `execFile`: execFile's timeout only kills
 * latexmk, leaving pdflatex running (e.g. `\def\a{\a}\a` loops forever). Here latexmk leads its
 * own process group and the timeout kills the whole group.
 */
@Injectable()
export class LatexmkRunner {
  constructor(@Inject(APP_CONFIG) private readonly config: WorkerConfig) {}

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
    const args = [
      ...ENGINE_FLAGS[engine],
      // A project-supplied .latexmkrc would run as Perl inside the worker.
      '-norc',
      '-interaction=nonstopmode',
      // "Try to compile despite errors": nonstopmode without halting still yields a PDF.
      ...(options.haltOnError === false ? [] : ['-halt-on-error']),
      // Draft: images as frames, no overfull marks; same as Overleaf's "fast" mode.
      ...(options.draft ? [String.raw`-usepretex=\PassOptionsToPackage{draft}{graphicx}`] : []),
      '-no-shell-escape',
      '-file-line-error',
      '-synctex=1',
      '-output-directory=out',
      mainFile,
    ];
    // HOME and the per-user texmf trees live outside the snapshot, so project files can never be
    // picked up as a format, Lua bytecode cache or fontconfig.
    const home = await mkdtemp(join(tmpdir(), 'ls-home-'));
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

    try {
      return await new Promise((resolve, reject) => {
        const child = spawn('latexmk', args, {
          cwd: workDir,
          env,
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
      await rm(home, { recursive: true, force: true });
    }
  }
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
