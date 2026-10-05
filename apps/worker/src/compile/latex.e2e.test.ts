import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { WorkerConfig } from '@latex-studio/core';
import {
  detectEngine,
  findUsepackages,
  insertPackagesInput,
  type PackageManifest,
  parseLatexLog,
  renderPackagesTex,
} from '@latex-studio/latex-tools';
import { afterEach, describe, expect, it } from 'vitest';
import { type Engine, LatexmkRunner } from './latexmk-runner';
import { toBuildStatus } from './log-to-build';

// Real compiles of the fixtures in apps/worker/test/fixtures, one per production incident.
// Run with `pnpm test:latex`; skipped where latexmk is not installed.
const latexmkAvailable = (() => {
  try {
    // MiKTeX's wrappers may exit non-zero ("not checked for MiKTeX updates"): only ENOENT matters.
    execFileSync('latexmk', ['-v'], { stdio: 'ignore', windowsHide: true });
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code !== 'ENOENT';
  }
})();

const FIXTURES = join(__dirname, '../../test/fixtures');
const runner = new LatexmkRunner({ COMPILE_TIMEOUT_MS: 240_000 } as WorkerConfig);
const dirs: string[] = [];
const WINDOWS = process.platform === 'win32';

/** Copies a fixture to a temp dir; `edit` may rewrite files there before compiling. */
async function project(fixture: string, edit?: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), `latex-e2e-${fixture}-`));
  dirs.push(dir);
  await cp(join(FIXTURES, fixture), dir, { recursive: true });
  await edit?.(dir);
  return dir;
}

/** Same steps as CompileProcessor: run latexmk, parse out/<stem>.log, derive the status. */
async function compile(
  dir: string,
  engine: Engine,
  options: { draft?: boolean; haltOnError?: boolean } = {},
) {
  const run = await runner.run({ workDir: dir, engine, mainFile: 'main.tex', options });
  const log = await readFile(join(dir, 'out', 'main.log'), 'utf8').catch(() => '');
  const status = toBuildStatus({
    ...run,
    pdfExists: existsSync(join(dir, 'out', 'main.pdf')),
    haltOnError: options.haltOnError,
  });
  return { run, log, status, ...parseLatexLog(log) };
}

/** Writes latex-packages.tex the way the API does: manifest + every \usepackage in the sources. */
async function writePackages(dir: string, manifest: PackageManifest, sources: string[]) {
  const texts = await Promise.all(sources.map((f) => readFile(join(dir, f), 'utf8')));
  const usage = texts.flatMap(findUsepackages);
  await writeFile(join(dir, 'latex-packages.tex'), renderPackagesTex(manifest, usage));
}

describe.skipIf(!latexmkAvailable)('LaTeX compile regressions', () => {
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
  });

  describe('fontspec', () => {
    it('is detected as needing xelatex at import', async () => {
      const source = await readFile(join(FIXTURES, 'fontspec/main.tex'), 'utf8');
      expect(detectEngine(source)).toBe('xelatex');
    });

    it('fails fatally under pdflatex with a parsed error', async () => {
      const r = await compile(await project('fontspec'), 'pdflatex');
      expect(r.status).toBe('failed');
      expect(r.errors.map((e) => e.message).join('\n')).toMatch(/fontspec|XeTeX or LuaTeX/i);
    });

    // lualatex: `--safer` made luaotfload abort, so the runner must not pass it.
    it.each(['xelatex', 'lualatex'] as const)('compiles with %s', async (engine) => {
      const r = await compile(await project('fontspec'), engine);
      expect(r.log).not.toContain("can't run with option --safer");
      expect(r.errors).toEqual([]);
      expect(r.status).toBe('succeeded');
    });
  });

  it('inserts \\input{latex-packages} after a multi-line \\documentclass with commented options', async () => {
    const dir = await project('documentclass-comments', async (d) => {
      const main = join(d, 'main.tex');
      await writeFile(main, insertPackagesInput(await readFile(main, 'utf8')));
      await writePackages(d, [{ name: 'amsmath', enabled: true, order: 0 }], ['main.tex']);
    });
    expect(await readFile(join(dir, 'main.tex'), 'utf8')).toContain(
      ']{memoir}\n\\input{latex-packages}\n',
    );
    const r = await compile(dir, 'pdflatex');
    expect(r.errors).toEqual([]);
    expect(r.status).toBe('succeeded');
  });

  describe('package bypass', () => {
    const sources = ['main.tex', 'preamble.tex'];

    it('skips disabled packages the source still loads, without an option clash', async () => {
      const dir = await project('bypass', (d) =>
        writePackages(
          d,
          [
            { name: 'hyperref', enabled: false, order: 0 },
            { name: 'geometry', enabled: false, order: 1 },
          ],
          sources,
        ),
      );
      const packages = await readFile(join(dir, 'latex-packages.tex'), 'utf8');
      expect(packages).toContain(String.raw`\csname opt@hyperref.sty\endcsname{colorlinks}`);
      expect(packages).toContain(String.raw`\csname opt@geometry.sty\endcsname{left=3cm}`);
      const r = await compile(dir, 'pdflatex');
      expect(r.status).toBe('succeeded');
      expect(r.log).not.toContain('Option clash');
      expect(r.log).not.toMatch(/hyperref\.sty|geometry\.sty/); // really skipped
    });

    it('re-enabled packages the source loads are not loaded twice', async () => {
      const dir = await project('bypass', (d) =>
        writePackages(
          d,
          [
            { name: 'hyperref', options: 'hidelinks', enabled: true, order: 0 },
            { name: 'geometry', options: 'margin=1in', enabled: true, order: 1 },
          ],
          sources,
        ),
      );
      const r = await compile(dir, 'pdflatex');
      expect(r.status).toBe('succeeded');
      expect(r.log).not.toContain('Option clash');
      expect(r.log).toMatch(/hyperref\.sty/);
    });
  });

  it('a duplicated main file fails with an error at the second \\documentclass', async () => {
    const r = await compile(await project('duplicate-main'), 'pdflatex');
    expect(r.status).toBe('failed');
    expect(r.errors[0]).toMatchObject({
      file: expect.stringMatching(/main\.tex$/),
      line: 4,
      message: expect.stringContaining('LaTeX Error'),
    });
  });

  it('reports an undefined control sequence in a sub-file with its file and line', async () => {
    const r = await compile(await project('errors'), 'pdflatex');
    expect(r.status).toBe('failed');
    expect(r.errors[0]).toMatchObject({
      file: expect.stringMatching(/chapters[\\/]intro\.tex$/),
      line: 3,
      message: expect.stringContaining('Undefined control sequence'),
    });
  });

  it('classifies a recovered "Infinite glue shrinkage" as a warning', async () => {
    const r = await compile(await project('glue'), 'pdflatex');
    expect(r.status).toBe('succeeded');
    expect(r.errors).toEqual([]);
    // Whether this page layout triggers the message depends on the memoir/lipsum versions (TeX
    // Live 2026 does not, MiKTeX does); when it does, it must land in warnings. The parser's unit
    // test pins the classification itself.
    if (!r.log.includes('Infinite glue shrinkage')) return;
    const raw = r.log.split('
').filter((l) => l.includes('Infinite glue')).slice(0, 3);
    expect(r.warnings, `raw log lines: ${JSON.stringify(raw)}`).toContainEqual(
      expect.objectContaining({
        message: expect.stringContaining('Infinite glue shrinkage found in box being split'),
      }),
    );
  });

  it('still produces a PDF with "compile despite errors" (haltOnError false)', async () => {
    const r = await compile(await project('errors'), 'pdflatex', { haltOnError: false });
    expect(r.status).toBe('succeeded');
    expect(r.run.exitCode).not.toBe(0);
    expect(r.errors.length).toBeGreaterThan(0);
  });

  // MiKTeX's latexmk strips the backslashes and braces from -usepretex, so pdflatex runs
  // `PassOptionsToPackagedraftgraphicx\input{main.tex}` and dies: draft is broken on Windows.
  it.skipIf(WINDOWS)('compiles in draft mode', async () => {
    const r = await compile(await project('glue'), 'pdflatex', { draft: true });
    expect(r.status).toBe('succeeded');
  });
});
