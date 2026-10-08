import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import type { AppConfig } from '@latex-studio/core';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  PayloadTooLargeException,
} from '@nestjs/common';
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
  createdAt: new Date(),
});

describe('ProjectsService', () => {
  let dir: string;
  let projects: FakeProjects;
  let storage: FsProjectStorage;
  let service: ProjectsService;
  let filesService: FilesService;
  let sync: FakeDocumentSync;
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
    sync = new FakeDocumentSync();
    service = new ProjectsService(projects, storage, lock, config, undefined, sync);
    filesService = new FilesService(storage, lock, config, new FakeDocumentSync(), projects);
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
    expect(sync.calls).toEqual([]);
    await service.remove(project, ana);
    expect(sync.calls).toEqual(['revoke all']);
    expect(projects.rows).toHaveLength(0);
    expect(existsSync(join(dir, project.id))).toBe(false);
    expect(existsSync(join(dir, 'builds', project.id))).toBe(false);
  });

  it('caps the number of projects per owner with 409', async () => {
    await service.create(ana, 'One');
    await service.create(ana, 'Two');
    await expect(service.create(ana, 'Three')).rejects.toBeInstanceOf(ConflictException);
  });

  it('pages by timestamp and ID, filters on the server, and rejects mismatched cursors', async () => {
    const updatedAt = new Date('2026-01-01T10:00:00.123Z');
    for (const [index, name] of ['Tese', 'Artigo', 'Relatório'].entries()) {
      const id = `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
      const ownerId = index === 2 ? bob.id : ana.id;
      projects.rows.push({
        id,
        ownerId,
        name,
        mainFile: 'main.tex',
        engine: 'pdflatex',
        createdAt: updatedAt,
        updatedAt,
      });
      projects.members.push({
        projectId: id,
        userId: ana.id,
        role: index === 2 ? 'editor' : 'owner',
      });
    }

    const first = await service.listForUser(ana, { limit: 1 });
    const second = await service.listForUser(ana, { limit: 1, cursor: first.nextCursor ?? '' });
    const third = await service.listForUser(ana, { limit: 1, cursor: second.nextCursor ?? '' });
    expect([first, second, third].flatMap((page) => page.items.map((p) => p.name))).toEqual([
      'Relatório',
      'Artigo',
      'Tese',
    ]);
    expect(first.total).toBe(3);
    expect(third.nextCursor).toBeNull();

    const own = await service.listForUser(ana, { filter: 'mine' });
    expect(own.items.map((p) => p.name)).toEqual(['Artigo', 'Tese']);
    const searched = await service.listForUser(ana, { search: 'relatorio' });
    expect(searched.items.map((p) => p.name)).toEqual(['Relatório']);
    await expect(
      service.listForUser(ana, { filter: 'mine', cursor: first.nextCursor ?? '' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.listForUser(ana, { cursor: 'invalid!' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
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
