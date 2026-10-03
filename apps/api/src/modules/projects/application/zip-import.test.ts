import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buffer } from 'node:stream/consumers';
import type { AppConfig } from '@latex-studio/core';
import { BadRequestException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ZipFile } from 'yazl';
import type { ProjectFiles } from '../domain/project-storage';
import { FsProjectStorage } from '../infrastructure/fs-project-storage';
import { extractZip } from './zip-import';

const QUOTA = 1024 * 1024;

function makeZip(entries: Record<string, string | Buffer>): Promise<Buffer> {
  const zip = new ZipFile();
  for (const [name, content] of Object.entries(entries)) zip.addBuffer(Buffer.from(content), name);
  zip.end();
  return buffer(zip.outputStream);
}

describe('extractZip', () => {
  let dir: string;
  let files: ProjectFiles;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'zip-'));
    files = await new FsProjectStorage({ REPOS_DIR: dir } as AppConfig).init('p');
  });

  afterEach(() => rm(dir, { recursive: true, force: true }));

  const written = async () => (await files.repo.listFiles()).map((f) => f.path).sort();

  it('strips a single common root folder', async () => {
    const zip = await makeZip({ 'thesis/main.tex': 'x', 'thesis/fig/a.png': 'y' });
    await extractZip(zip, files, QUOTA);
    expect(await written()).toEqual(['fig/a.png', 'main.tex']);
  });

  it('rejects a path escaping the project with 400', async () => {
    // yazl refuses `..`, so the name is patched in the raw bytes (same length).
    const zip = await makeZip({ 'XX/evil.tex': 'x', 'ok.tex': 'y' });
    const patched = Buffer.from(zip.toString('latin1').replaceAll('XX/evil', '../evil'), 'latin1');
    await expect(extractZip(patched, files, QUOTA)).rejects.toThrow(/\.\.\/evil\.tex/);
    await expect(extractZip(patched, files, QUOTA)).rejects.toBeInstanceOf(BadRequestException);
    expect(await written()).toEqual([]);
  });

  it('drops .git and .gitignore entries', async () => {
    const zip = await makeZip({
      '.git/hooks/post-checkout': '#!/bin/sh',
      '.gitignore': '*.aux',
      'main.tex': 'x',
    });
    await extractZip(zip, files, QUOTA);
    expect(await written()).toEqual(['main.tex']);
  });

  it('rejects declared sizes above the quota before writing anything', async () => {
    const zip = await makeZip({ 'a.tex': 'small', 'b.tex': Buffer.alloc(QUOTA + 1) });
    await expect(extractZip(zip, files, QUOTA)).rejects.toThrow(/quota/);
    expect(await readdir(join(dir, 'p'))).toEqual(['.git']);
  });

  it('rejects more than 5000 entries', async () => {
    const entries: Record<string, string> = {};
    for (let i = 0; i <= 5000; i++) entries[`f${i}.tex`] = '';
    await expect(extractZip(await makeZip(entries), files, QUOTA)).rejects.toThrow(/5000/);
  });
});
