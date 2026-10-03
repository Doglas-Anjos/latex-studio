import { execFile, spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { assertNoUnsafeIncludes, parseTexcount } from './tools.processor';

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
