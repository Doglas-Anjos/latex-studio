import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AppConfig } from '@latex-studio/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import yauzl from 'yauzl';
import type { Project } from '../../projects/domain/project';
import { FsProjectStorage } from '../../projects/infrastructure/fs-project-storage';
import { ExportService, slugify } from './export.service';

const entries = (buf: Buffer) =>
  new Promise<string[]>((resolve, reject) => {
    yauzl.fromBuffer(buf, { lazyEntries: true }, (err, zip) => {
      if (err) return reject(err);
      const names: string[] = [];
      zip.on('entry', (e: yauzl.Entry) => {
        names.push(e.fileName);
        zip.readEntry();
      });
      zip.on('end', () => resolve(names));
      zip.on('error', reject);
      zip.readEntry();
    });
  });

describe('ExportService', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'export-'));
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it('zips the working files and leaves .git out', async () => {
    const storage = new FsProjectStorage({
      REPOS_DIR: dir,
      BUILDS_DIR: join(dir, 'builds'),
    } as AppConfig);
    const files = await storage.init('p1');
    await files.write('main.tex', 'hello');
    await files.write('chap/a.tex', 'a');
    const chunks: Buffer[] = [];
    const out = await new ExportService(storage).sourceZip({ id: 'p1', name: 'X' } as Project);
    for await (const c of out) chunks.push(c as Buffer);
    expect((await entries(Buffer.concat(chunks))).sort()).toEqual(['chap/a.tex', 'main.tex']);
  });

  it('slugifies names', () => {
    expect(slugify(' Minha Tese! ')).toBe('minha-tese');
    expect(slugify('!!!')).toBe('project');
  });
});
