import { execFile, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { Job } from 'bullmq';
import { describe, expect, it, type Mock, vi } from 'vitest';
import { assertNoUnsafeIncludes, parseTexcount, ToolsProcessor } from './tools.processor';

// The promisified execFile is a spy that defaults to the real one.
vi.mock('node:child_process', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:child_process')>();
  const { promisify } = await import('node:util');
  const execFile = Object.assign(real.execFile.bind(null), {
    [promisify.custom]: vi.fn(promisify(real.execFile)),
  });
  return { ...real, execFile };
});

const run = promisify(execFile);
const texcountAvailable = spawnSync('texcount', ['-help'], { windowsHide: true }).status === 0;

describe('parseTexcount', () => {
  it('reads words, headers and captions', () => {
    expect(parseTexcount('12+3+4 (2/1/0/0) Total\n')).toMatchObject({
      words: 12,
      headers: 3,
      captions: 4,
    });
  });

  it('falls back to raw', () => {
    expect(parseTexcount('!!! File not found !!!')).toEqual({ raw: '!!! File not found !!!' });
  });

  it.skipIf(!texcountAvailable)('parses real texcount output', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'texcount-'));
    try {
      await writeFile(
        join(dir, 'main.tex'),
        '\\documentclass{article}\n\\begin{document}\none two three four\n\\end{document}\n',
      );
      const { stdout } = await run(
        'texcount',
        ['-total', '-brief', '-nosub', '-inc', '-merge', 'main.tex'],
        { cwd: dir, windowsHide: true },
      );
      expect(parseTexcount(stdout)).toMatchObject({ words: 4 });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

it('refuses absolute and parent paths in input-like commands', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ls-inc-'));
  await writeFile(join(dir, 'a.tex'), String.raw`\input{chapters/intro}`);
  await writeFile(join(dir, 'b.tex'), String.raw`\includegraphics[width=1cm]{/proc/self/environ}`);
  await expect(assertNoUnsafeIncludes(dir, ['a.tex'])).resolves.toBeUndefined();
  await expect(assertNoUnsafeIncludes(dir, ['a.tex', 'b.tex'])).rejects.toThrow(/b\.tex/);
});

describe('format', () => {
  const runSpy = (execFile as unknown as Record<symbol, Mock>)[promisify.custom] as Mock;
  const proc = new ToolsProcessor({} as never, { REPOS_DIR: 'x', BUILDS_DIR: 'x' } as never);
  const format = (path: string, text = '\\item x\n') =>
    proc.process({ data: { projectId: 'p1', kind: 'format', path, text } } as Job<never>);

  it('runs latexindent on the submitted text with an argument array', async () => {
    runSpy.mockResolvedValueOnce({ stdout: 'formatted', stderr: '' });
    await expect(format('sub/a.tex')).resolves.toEqual({ text: 'formatted' });
    const [cmd, args, opts] = runSpy.mock.calls.at(-1) as [
      string,
      string[],
      Record<string, unknown>,
    ];
    expect(cmd).toBe('latexindent');
    expect(args).toEqual(["-y=defaultIndent: '  '", '-g=indent.log', 'in.tex']);
    expect(opts).toMatchObject({ timeout: 15_000, maxBuffer: 2 * 1024 * 1024 });
    expect(opts).not.toHaveProperty('shell');
    expect(opts.env).toEqual({ PATH: process.env.PATH, HOME: opts.cwd });
  });

  it('rejects other extensions and oversized text before running', async () => {
    runSpy.mockClear();
    await expect(format('sub/a.txt')).rejects.toThrow(/Invalid path/);
    await expect(format('a.tex', 'x'.repeat(1024 * 1024 + 1))).rejects.toThrow(/too large/);
    expect(runSpy).not.toHaveBeenCalled();
  });
});
