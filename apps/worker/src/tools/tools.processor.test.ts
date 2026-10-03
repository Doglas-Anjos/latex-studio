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

  async function setup() {
    const repos = await mkdtemp(join(tmpdir(), 'ls-fmt-'));
    await mkdir(join(repos, 'p1', 'sub'), { recursive: true });
    await writeFile(join(repos, 'p1', 'sub', 'a.tex'), '\\item x\n');
    const db = {
      select: () => ({ from: () => ({ where: async () => [{ mainFile: 'main.tex' }] }) }),
    };
    const proc = new ToolsProcessor(db as never, { REPOS_DIR: repos, BUILDS_DIR: repos } as never);
    const format = (path: string) =>
      proc.process({ data: { projectId: 'p1', kind: 'format', path } } as Job<never>);
    return { repos, format };
  }

  it('runs latexindent with an argument array and returns stdout as text', async () => {
    const { repos, format } = await setup();
    runSpy.mockResolvedValueOnce({ stdout: 'formatted', stderr: '' });
    try {
      await expect(format('sub/a.tex')).resolves.toEqual({ text: 'formatted' });
      expect(runSpy).toHaveBeenCalledWith(
        'latexindent',
        ["-y=defaultIndent: '  '", '-g=indent.log', 'sub/a.tex'],
        expect.objectContaining({ timeout: 60_000, maxBuffer: 4 * 1024 * 1024 }),
      );
      expect(runSpy.mock.calls[0]?.[2]).not.toHaveProperty('shell');
    } finally {
      await rm(repos, { recursive: true, force: true });
    }
  });

  it('rejects traversal, option-like names and other extensions before running', async () => {
    const { repos, format } = await setup();
    runSpy.mockClear();
    try {
      for (const path of ['../x.tex', '-flag.tex', 'sub/-w.tex', 'sub/a.txt']) {
        await expect(format(path)).rejects.toThrow(/Invalid path/);
      }
      expect(runSpy).not.toHaveBeenCalled();
    } finally {
      await rm(repos, { recursive: true, force: true });
    }
  });
});
