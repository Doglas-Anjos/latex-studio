import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { WorkerConfig } from '@latex-studio/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LatexmkRunner } from './latexmk-runner';
import { Sandbox } from './sandbox';

const latexmkAvailable = (() => {
  try {
    execFileSync('latexmk', ['-v'], { stdio: 'ignore', windowsHide: true });
    return true;
  } catch {
    return false;
  }
})();

const doc = (body: string) =>
  [
    String.raw`\documentclass{article}`,
    String.raw`\begin{document}`,
    body,
    String.raw`\end{document}`,
    '',
  ].join('\n');

describe('LatexmkRunner', () => {
  let dir: string;
  const runner = (timeout = 120_000) =>
    new LatexmkRunner(
      { COMPILE_TIMEOUT_MS: timeout } as WorkerConfig,
      new Sandbox({ COMPILE_SANDBOX: 'off' } as never),
    );

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'latexmk-test-'));
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it.skipIf(!latexmkAvailable)(
    'compiles a minimal document into out/main.pdf',
    async () => {
      await writeFile(join(dir, 'main.tex'), doc('Hello'));
      const result = await runner().run({ workDir: dir, engine: 'pdflatex', mainFile: 'main.tex' });
      expect(result).toMatchObject({ exitCode: 0, timedOut: false });
      expect(existsSync(join(dir, 'out', 'main.pdf'))).toBe(true);
    },
    150_000,
  );

  it.skipIf(!latexmkAvailable)(
    'does not run write18 nor read outside the work dir',
    async () => {
      const marker = join(dir, 'pwned');
      await writeFile(
        join(dir, 'main.tex'),
        doc(String.raw`\immediate\write18{echo x > pwned}\input{/etc/passwd}`),
      );
      const result = await runner().run({ workDir: dir, engine: 'pdflatex', mainFile: 'main.tex' });
      expect(typeof result.exitCode).toBe('number');
      expect(existsSync(marker)).toBe(false);
      const log = await readFile(join(dir, 'out', 'main.log'), 'utf8').catch(() => '');
      expect(log).not.toContain('root:x:0:0');
    },
    150_000,
  );

  // On Windows MiKTeX's pdflatex is reparented away from latexmk, so taskkill /T misses it and the
  // test would leave it looping; the process-group kill is what runs in the Linux container.
  it.skipIf(!latexmkAvailable || process.platform === 'win32')(
    'kills a compile that loops forever, pdflatex included',
    async () => {
      await writeFile(join(dir, 'main.tex'), doc(String.raw`\def\a{\a}\a`));
      const result = await runner(3_000).run({
        workDir: dir,
        engine: 'pdflatex',
        mainFile: 'main.tex',
      });
      expect(result.timedOut).toBe(true);
    },
    90_000,
  );

  it('rejects a main file that looks like an option', async () => {
    await expect(
      runner().run({ workDir: dir, engine: 'pdflatex', mainFile: '-norc' }),
    ).rejects.toThrow();
  });
});
