import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import type { AppConfig } from '@latex-studio/core';
import { ConflictException, ForbiddenException, PayloadTooLargeException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeDocumentSync } from '../../collab/testing/fake-document-sync';
import { FilesService } from '../../files/application/files.service';
import type { User } from '../../users/domain/user';
import { FsProjectStorage } from '../infrastructure/fs-project-storage';
import { FakeProjects } from '../testing/fake-project.repository';
import { ProjectLock } from './project-lock';
import { ProjectsService } from './projects.service';

const user = (id: string, name: string): User => ({
  id,
  email: `${name.toLowerCase()}@example.com`,
  name,
  role: 'user',
  status: 'active',
  createdAt: new Date(),
});

describe('ProjectsService', () => {
  let dir: string;
  let projects: FakeProjects;
  let storage: FsProjectStorage;
  let service: ProjectsService;
  let filesService: FilesService;
  const ana = user('00000000-0000-4000-8000-000000000001', 'Ana');
  const bob = user('00000000-0000-4000-8000-000000000002', 'Bob');

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'projects-'));
    const config = {
      REPOS_DIR: dir,
      BUILDS_DIR: join(dir, 'builds'),
      PROJECT_QUOTA_MB: 1,
      MAX_PROJECTS_PER_USER: 2,
    } as AppConfig;
    const lock = new ProjectLock();
    projects = new FakeProjects();
    storage = new FsProjectStorage(config);
    service = new ProjectsService(projects, storage, lock, config);
    filesService = new FilesService(storage, lock, config, new FakeDocumentSync());
  });

  afterEach(() => rm(dir, { recursive: true, force: true }));

  it('creates the row, the three starter files and one commit by the owner', async () => {
    const project = await service.create(ana, 'Thesis');
    expect(projects.members).toEqual([{ projectId: project.id, userId: ana.id, role: 'owner' }]);

    const { repo } = storage.open(project.id);
    const paths = (await repo.listFiles()).map((f) => f.path).sort();
    expect(paths).toEqual(['latex-packages.json', 'latex-packages.tex', 'main.tex']);
    expect(Buffer.from(await repo.readFile('main.tex')).toString()).toContain(
      '\\input{latex-packages}',
    );
    const log = await repo.log();
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({
      message: 'Initial commit',
      author: { name: 'Ana', email: 'ana@example.com' },
    });
  });

  it('lets only the owner delete, removing the row and the directory', async () => {
    const project = await service.create(ana, 'Thesis');
    projects.members.push({ projectId: project.id, userId: bob.id, role: 'editor' });

    await expect(service.remove(project, bob)).rejects.toBeInstanceOf(ForbiddenException);
    expect(existsSync(join(dir, project.id))).toBe(true);

    await mkdir(join(dir, 'builds', project.id, 'b1'), { recursive: true });
    await service.remove(project, ana);
    expect(projects.rows).toHaveLength(0);
    expect(existsSync(join(dir, project.id))).toBe(false);
    expect(existsSync(join(dir, 'builds', project.id))).toBe(false);
  });

  it('caps the number of projects per owner with 409', async () => {
    await service.create(ana, 'One');
    await service.create(ana, 'Two');
    await expect(service.create(ana, 'Three')).rejects.toBeInstanceOf(ConflictException);
  });

  it('answers 413 when a created file would exceed the quota, writing nothing', async () => {
    const project = await service.create(ana, 'Thesis');
    const big = 'x'.repeat(1024 * 1024);
    await expect(filesService.create(project, ana, 'big.tex', big)).rejects.toBeInstanceOf(
      PayloadTooLargeException,
    );
    expect(existsSync(join(dir, project.id, 'big.tex'))).toBe(false);
    expect(await storage.open(project.id).repo.log()).toHaveLength(1);
  });

  it('serializes mutations per project: two concurrent creates of one path give one 409', async () => {
    const project = await service.create(ana, 'Thesis');
    const results = await Promise.allSettled([
      filesService.create(project, ana, 'a.tex', 'one'),
      filesService.create(project, ana, 'a.tex', 'two'),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(await storage.open(project.id).repo.log()).toHaveLength(2);
  });

  it('never exposes the temp file of an in-flight write', async () => {
    const project = await service.create(ana, 'Thesis');
    const files = storage.open(project.id);
    const source = new PassThrough();
    const writing = files.writeStream('fig.png', source);
    source.write('first half');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect((await files.repo.listFiles()).map((f) => f.path).sort()).toEqual([
      'latex-packages.json',
      'latex-packages.tex',
      'main.tex',
    ]);
    source.end(' second half');
    await writing;
    expect(Buffer.from(await files.repo.readFile('fig.png')).toString()).toBe(
      'first half second half',
    );
  });
});
