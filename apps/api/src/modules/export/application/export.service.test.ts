import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AppConfig } from '@latex-studio/core';
import { GitRepository } from '@latex-studio/git-store';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import yauzl from 'yauzl';
import { ProjectsService } from '../../projects/application/projects.service';
import type { Project } from '../../projects/domain/project';
import type { ProjectRepository } from '../../projects/domain/project.repository';
import { FsProjectStorage } from '../../projects/infrastructure/fs-project-storage';
import type { User } from '../../users/domain/user';
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

const noQueue = { add: async () => ({ id: '1' }), getJob: async () => undefined } as never;

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
    const out = await new ExportService(storage, {} as never, noQueue, {
      BUILDS_DIR: join(dir, 'builds'),
    } as AppConfig).sourceZip({ id: 'p1', name: 'X' } as Project);
    for await (const c of out) chunks.push(c as Buffer);
    expect((await entries(Buffer.concat(chunks))).sort()).toEqual(['chap/a.tex', 'main.tex']);
  });

  it('copies the files into a new project with one commit', async () => {
    const config = { REPOS_DIR: dir, BUILDS_DIR: join(dir, 'builds') } as AppConfig;
    const storage = new FsProjectStorage(config);
    const files = await storage.init('p1');
    await files.write('main.tex', 'hello');
    await files.write('chap/a.tex', 'a');
    const rows: Array<{ id: string; name: string; mainFile?: string }> = [];
    const repo = {
      countForUser: async () => 0,
      create: async (p: { id: string; name: string; mainFile?: string }) => {
        rows.push(p);
        return { ...p, ownerId: 'u1' } as Project;
      },
    } as unknown as ProjectRepository;
    const projects = new ProjectsService(repo, storage, {} as never, config);
    const user = { id: 'u1', name: 'Ana', email: 'ana@x.io' } as User;
    const exporter = new ExportService(storage, projects, noQueue, config);
    const copy = await exporter.copy(
      { id: 'p1', name: 'Thesis', mainFile: 'chap/a.tex' } as Project,
      user,
    );
    expect(copy.name).toBe('Copy of Thesis');
    expect(rows[0]?.mainFile).toBe('chap/a.tex');
    const repoCopy = GitRepository.open(join(dir, copy.id));
    expect((await repoCopy.listFiles()).map((f) => f.path).sort()).toEqual([
      'chap/a.tex',
      'main.tex',
    ]);
    expect(await repoCopy.log(10)).toHaveLength(1);
  });

  it('hides jobs of other projects', async () => {
    const queue = {
      add: async () => ({ id: '1' }),
      getJob: async () => ({ data: { projectId: 'other', kind: 'wordcount' } }),
    } as never;
    const exporter = new ExportService({} as never, {} as never, queue, {
      BUILDS_DIR: dir,
    } as AppConfig);
    await expect(exporter.jobStatus({ id: 'p1' } as Project, '1')).rejects.toThrow('Job not found');
  });

  it('enqueues a format job for a valid path only', async () => {
    const added: unknown[] = [];
    const queue = {
      add: async (_: string, data: unknown) => {
        added.push(data);
        return { id: '7' };
      },
    };
    const storage = new FsProjectStorage({ REPOS_DIR: dir, BUILDS_DIR: dir } as AppConfig);
    const exporter = new ExportService(
      storage,
      {} as never,
      queue as never,
      {
        BUILDS_DIR: dir,
      } as AppConfig,
    );
    const project = { id: 'p1' } as Project;
    await expect(exporter.requestFormat(project, 'chap/a.tex')).resolves.toEqual({ jobId: '7' });
    expect(added).toEqual([{ projectId: 'p1', kind: 'format', path: 'chap/a.tex' }]);
    expect(() => exporter.requestFormat(project, '../x.tex')).toThrow('Invalid path');
  });

  it('slugifies names', () => {
    expect(slugify(' Minha Tese! ')).toBe('minha-tese');
    expect(slugify('!!!')).toBe('project');
  });
});
