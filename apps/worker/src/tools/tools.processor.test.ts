import { execFile, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { Job } from 'bullmq';
import { afterAll, beforeAll, describe, expect, it, type Mock, vi } from 'vitest';
import {
  assertNoUnsafeIncludes,
  findUnsafeInclude,
  parseTexcount,
  ToolsProcessor,
} from './tools.processor';

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
  await writeFile(join(dir, 'big.tex'), 'x'.repeat(1024 * 1024 + 1));
  await expect(assertNoUnsafeIncludes(dir, ['big.tex'])).rejects.toThrow(/too large/);
  await rm(dir, { recursive: true, force: true });
});

describe('findUnsafeInclude', () => {
  it.each([
    String.raw`\lstinputlisting{./../../proc/1/environ}`,
    String.raw`\input{sub/../../../etc/os-release}`,
    String.raw`\inputminted{latex}{/etc/passwd}`,
    String.raw`\inputminted[linenos]{latex}{../x.tex}`,
    String.raw`\includegraphics[width=\linewidth]{C:/x.png}`,
    String.raw`\import{../other/}{main}`,
    String.raw`\bibliography{refs,/etc/passwd}`,
    String.raw`\input{"|cat /etc/passwd"}`,
    String.raw`\input{{}/etc/passwd}`,
    String.raw`\input{~/x}`,
    String.raw`\input{sub\..\x}`,
    String.raw`\input /etc/passwd`,
    String.raw`\input{never closed`,
  ])('rejects %s', (tex) => {
    expect(findUnsafeInclude(tex)).toBeDefined();
  });

  it.each([
    String.raw`\input{chapters/intro}`,
    String.raw`\includegraphics[width=0.5\textwidth]{fig/a..b.png}`,
    String.raw`\InputIfFileExists{local.cfg}{}{\typeout{none}}`,
    String.raw`\subimport{chapters/}{intro} \inputx{/etc}`,
  ])('accepts %s', (tex) => {
    expect(findUnsafeInclude(tex)).toBeUndefined();
  });

  it('scans a 1 MB adversarial line quickly', () => {
    const start = performance.now();
    findUnsafeInclude('\\input['.repeat(150_000));
    findUnsafeInclude(`\\input{${'\\input{'.repeat(150_000)}`);
    expect(performance.now() - start).toBeLessThan(500);
  });
});

describe('format', () => {
  const runSpy = (execFile as unknown as Record<symbol, Mock>)[promisify.custom] as Mock;
  let builds: string;
  let proc: ToolsProcessor;
  beforeAll(async () => {
    builds = await mkdtemp(join(tmpdir(), 'ls-builds-'));
    proc = new ToolsProcessor({} as never, { REPOS_DIR: 'x', BUILDS_DIR: builds } as never);
  });
  afterAll(() => rm(builds, { recursive: true, force: true }));
  const format = (path: string, text = '\\item x\n') =>
    proc.process({ id: '9', data: { projectId: 'p1', kind: 'format', path, text } } as Job<never>);

  it('runs latexindent on the submitted text and writes the result to disk', async () => {
    runSpy.mockResolvedValueOnce({ stdout: 'formatted', stderr: '' });
    // Not the text itself: BullMQ copies return values into Redis.
    await expect(format('sub/a.tex')).resolves.toEqual({ file: '9.txt' });
    expect(await readFile(join(builds, 'p1', 'format', '9.txt'), 'utf8')).toBe('formatted');
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
