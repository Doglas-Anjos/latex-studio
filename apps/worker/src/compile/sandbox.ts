import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { APP_CONFIG, type WorkerConfig } from '@latex-studio/core';
import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';

const run = promisify(execFile);

/**
 * bubblewrap arguments that confine a child to `workDir` (read-write) and the system read-only,
 * with a fresh PID namespace, no network, a private /tmp and exactly `env`. The child cannot read
 * other projects under the repos volume, /etc secrets, or the worker's own /proc/<pid>/environ
 * (which holds DATABASE_URL and REDIS_URL): LuaTeX's io.*, pandoc and texcount all follow paths,
 * and kpathsea's paranoid mode does not cover every one of them.
 */
export function bwrapArgs(workDir: string, env: Record<string, string | undefined>): string[] {
  const args = ['--unshare-all', '--die-with-parent', '--new-session', '--clearenv'];
  for (const [k, v] of Object.entries(env)) if (v !== undefined) args.push('--setenv', k, v);
  // --tmpfs /tmp before the workDir bind, so a snapshot that lives under /tmp is re-exposed on top.
  args.push(
    '--proc',
    '/proc',
    '--dev',
    '/dev',
    '--tmpfs',
    '/tmp',
    '--ro-bind',
    '/usr',
    '/usr',
    // Not all of /etc: only fontconfig (system fonts, for xelatex/lualatex) and any TeX config,
    // all optional. This keeps /etc/passwd, resolv.conf and the like out of the sandbox.
    '--ro-bind-try',
    '/etc/fonts',
    '/etc/fonts',
    '--ro-bind-try',
    '/etc/texmf',
    '/etc/texmf',
    '--ro-bind-try',
    '/etc/alternatives',
    '/etc/alternatives',
    '--symlink',
    'usr/bin',
    '/bin',
    '--symlink',
    'usr/sbin',
    '/sbin',
    '--symlink',
    'usr/lib',
    '/lib',
    '--symlink',
    'usr/lib64',
    '/lib64',
    '--bind',
    workDir,
    workDir,
    '--chdir',
    workDir,
  );
  return args;
}

/** True if unprivileged bubblewrap can create a namespace here (kernel/seccomp permitting). */
async function probe(): Promise<boolean> {
  try {
    await run(
      'bwrap',
      ['--unshare-all', '--die-with-parent', '--ro-bind', '/usr', '/usr', '--', '/usr/bin/true'],
      { timeout: 5000 },
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Wraps the compiler and the export tools in an OS sandbox when `COMPILE_SANDBOX` allows it and
 * bubblewrap works. `off` or a non-Linux host (dev with MiKTeX) runs them directly; `require`
 * refuses to start when the sandbox is unavailable, so production cannot silently lose it.
 */
@Injectable()
export class Sandbox implements OnApplicationBootstrap {
  private readonly logger = new Logger(Sandbox.name);
  private active = false;

  constructor(@Inject(APP_CONFIG) private readonly config: Pick<WorkerConfig, 'COMPILE_SANDBOX'>) {}

  async onApplicationBootstrap(): Promise<void> {
    const mode = this.config.COMPILE_SANDBOX;
    if (mode === 'off' || process.platform !== 'linux') {
      if (mode === 'require') {
        throw new Error('COMPILE_SANDBOX=require needs Linux with bubblewrap');
      }
      this.logger.warn(`compile sandbox off (mode=${mode}, platform=${process.platform})`);
      return;
    }
    this.active = await probe();
    if (!this.active) {
      if (mode === 'require') {
        throw new Error('COMPILE_SANDBOX=require but bubblewrap cannot create a namespace here');
      }
      this.logger.warn('compile sandbox unavailable (bubblewrap cannot unshare); running directly');
      return;
    }
    this.logger.log('compile sandbox active (bubblewrap)');
  }

  get enabled(): boolean {
    return this.active;
  }

  /** `spawn` args for latexmk: bwrap-wrapped when active, the command itself otherwise. */
  spawn(
    cmd: string,
    args: string[],
    workDir: string,
    env: Record<string, string | undefined>,
  ): { file: string; args: string[]; env: Record<string, string | undefined> } {
    if (!this.active) return { file: cmd, args, env };
    // The outer process only needs PATH to find bwrap; everything else is set inside the sandbox.
    return {
      file: 'bwrap',
      args: [...bwrapArgs(workDir, env), '--', cmd, ...args],
      env: { PATH: process.env.PATH },
    };
  }

  /** `execFile` for the export tools (pandoc, texcount, latexindent). */
  run(
    cmd: string,
    args: string[],
    opts: {
      cwd: string;
      env: Record<string, string | undefined>;
      timeout: number;
      maxBuffer: number;
    },
  ): Promise<{ stdout: string }> {
    if (!this.active) {
      return run(cmd, args, { ...opts, windowsHide: true }) as Promise<{ stdout: string }>;
    }
    // HOME under the host /tmp would be shadowed by the sandbox tmpfs; point it at the tmpfs.
    const env = { ...opts.env, HOME: '/tmp' };
    return run('bwrap', [...bwrapArgs(opts.cwd, env), '--', cmd, ...args], {
      timeout: opts.timeout,
      maxBuffer: opts.maxBuffer,
      env: { PATH: process.env.PATH },
      windowsHide: true,
    }) as Promise<{ stdout: string }>;
  }
}
