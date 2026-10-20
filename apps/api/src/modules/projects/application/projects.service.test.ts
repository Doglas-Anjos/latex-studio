import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import type { AppConfig } from '@latex-studio/core';
import { GitRepository } from '@latex-studio/git-store';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeDocumentSync } from '../../collab/testing/fake-document-sync';
import { ExportService } from '../../export/application/export.service';
import { FilesService } from '../../files/application/files.service';
import { LanService } from '../../lan/application/lan.service';
import { LanTokenService } from '../../lan/application/lan-token.service';
import { FakeLan } from '../../lan/testing/fake-lan.repository';
import { LAN_ISSUER, type User } from '../../users/domain/user';
import { FakeUsers } from '../../users/testing/fake-user.repository';
import { FsProjectStorage } from '../infrastructure/fs-project-storage';
import { FakeProjects } from '../testing/fake-project.repository';
import { accountRoom, type UploadPart } from './project-files';
import { ProjectLock } from './project-lock';
import { ProjectsService } from './projects.service';

/** A `name` field (read by import, ignored by upload), then one part per file. */
async function* parts(name: string, files: Record<string, string>): AsyncIterable<UploadPart> {
  yield { type: 'field', fieldname: 'name', value: name };
  for (const [filename, content] of Object.entries(files)) {
    const buffer = Buffer.from(content);
    const file = Readable.from([buffer]);
    yield { type: 'file', fieldname: 'files', filename, file, toBuffer: async () => buffer };
  }
}

const user = (id: string, name: string): User => ({
  id,
  email: `${name.toLowerCase()}@example.com`,
  name,
  createdAt: new Date(),
  issuer: 'local',
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

  it('lists a LAN guest only the published projects shared with them, and never lets one create', async () => {
    const repo = new FakeLan();
    const tokens = new LanTokenService({ LAN_SHARE: true, LAN_SECRET: 'x'.repeat(32) });
    tokens.setRemote(true);
    const lan = new LanService(repo, new FakeUsers(), tokens);
    const lock = new ProjectLock();
    const withLan = new ProjectsService(
      projects,
      storage,
      lock,
      {} as AppConfig,
      undefined,
      sync,
      lan,
    );
    const guest = { ...user('00000000-0000-4000-8000-0000000000b1', 'Gus'), issuer: LAN_ISSUER };
    const shared = '00000000-0000-4000-8000-0000000000a1';
    const unshared = '00000000-0000-4000-8000-0000000000a2';
    const unpublished = '00000000-0000-4000-8000-0000000000a3';
    for (const id of [shared, unshared, unpublished])
      await projects.create({ id, name: id }, ana.id);
    await lan.publish(shared);
    await lan.publish(unshared);
    await repo.createAccess(shared, guest.id, 'Gus', 'hash', 'viewer');
    await repo.createAccess(unpublished, guest.id, 'Gus', 'hash');

    const list = await withLan.listForUser(guest);
    expect(list.items).toEqual([
      expect.objectContaining({ id: shared, role: 'viewer', published: true }),
    ]);
    expect(list.total).toBe(1);
    await expect(withLan.create(guest, 'Mine')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(withLan.import(guest, parts('Mine', { 'main.tex': 'x' }))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
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

  /** Services over the shared fake repository and storage: 1 MB per project, `USER_QUOTA_MB`. */
  const make = (USER_QUOTA_MB?: number) => {
    const config = {
      REPOS_DIR: dir,
      BUILDS_DIR: join(dir, 'builds'),
      PROJECT_QUOTA_MB: 1,
      MAX_PROJECTS_PER_USER: 5,
      USER_QUOTA_MB,
    } as AppConfig;
    const lock = new ProjectLock();
    const files = new FilesService(storage, lock, config, new FakeDocumentSync(), projects);
    return { config, projects: new ProjectsService(projects, storage, lock, config), files };
  };
  const over = {
    status: 413,
    message:
      'Cota de armazenamento da conta excedida (1 MB). Exclua projetos que não usa para liberar espaço.',
  };
  const big = 'x'.repeat(600 * 1024); // each fits the 1 MB project quota, two do not fit 1 MB

  it('counts the history an import adds, with content that does not compress', async () => {
    const capped = make(1);
    // ~680 KB of base64 noise: fits as a tree, not with the ~500 KB its commit adds to history
    // (a history size cached before the repo existed would read 0 here).
    const noise = randomBytes(500 * 1024).toString('base64');
    await expect(capped.projects.import(ana, parts('N', { 'n.tex': noise }))).rejects.toMatchObject(
      over,
    );
    expect(await projects.ownedIds(ana.id)).toEqual([]);
  });

  it("caps the owner's storage over all their projects, collaborators' writes included", async () => {
    const capped = make(1);
    const uncapped = make();

    const a = await capped.projects.create(ana, 'A');
    await capped.files.create(a, ana, 'a.tex', big);
    // A second project that would push Ana past 1 MB is refused; without the cap it passes.
    await expect(capped.projects.import(ana, parts('B', { 'b.tex': big }))).rejects.toMatchObject(
      over,
    );
    expect(await projects.ownedIds(ana.id)).toEqual([a.id]);

    // Bob owns nothing: his writes to Ana's project count against Ana.
    const c = await capped.projects.create(ana, 'C');
    await projects.setMember(c.id, bob.id, 'editor');
    await expect(capped.files.create(c, bob, 'c.tex', big)).rejects.toMatchObject(over);
    await expect(capped.files.upload(c, parts('', { 'fig.png': big }))).rejects.toMatchObject(over);
    expect(await storage.open(c.id).isFile('fig.png')).toBe(false);

    await uncapped.files.upload(c, parts('', { 'fig.png': big }));
    await uncapped.projects.import(ana, parts('B', { 'b.tex': big }));
    expect(await projects.ownedIds(ana.id)).toHaveLength(3);
  });

  it('bounds an import by the room left in the account, and refuses a copy before writing', async () => {
    const capped = make(1);
    const a = await capped.projects.create(ana, 'A');
    await capped.files.create(a, ana, 'a.tex', big);

    // 1000 KB fits the 1 MB project quota, not the ~400 KB left: refused long before the end.
    let pulled = 0;
    async function* chunks() {
      for (; pulled < 10; pulled++) yield Buffer.alloc(100 * 1024);
    }
    async function* upload(): AsyncIterable<UploadPart> {
      yield { type: 'field', fieldname: 'name', value: 'B' };
      const file = chunks() as unknown as Readable;
      yield {
        type: 'file',
        fieldname: 'files',
        filename: 'b.bin',
        file,
        toBuffer: async () => {
          throw new Error('not read whole');
        },
      };
    }
    await expect(capped.projects.import(ana, upload())).rejects.toMatchObject(over);
    expect(pulled).toBeLessThan(6);

    const init = vi.spyOn(storage, 'init');
    const exporter = new ExportService(storage, capped.projects, {} as never, capped.config);
    await expect(exporter.copy(a, ana)).rejects.toMatchObject(over);
    expect(init).not.toHaveBeenCalled();
    expect(await projects.ownedIds(ana.id)).toEqual([a.id]);
  });

  it('refuses a blank project that does not fit, before writing once the account is full', async () => {
    const capped = make(1);
    const a = await capped.projects.create(ana, 'A');
    // Leaves 6000 bytes (measuring A fresh): not enough for the three starter files, 4 KiB each.
    const fill = (await accountRoom(projects, storage, 1, a)) - 6000;
    await storage.open(a.id).write('fill.bin', new Uint8Array(fill));
    expect(await accountRoom(projects, storage, 1, a)).toBe(6000);
    await expect(capped.projects.create(ana, 'B')).rejects.toMatchObject(over);

    await storage.open(a.id).write('more.bin', new Uint8Array(8000));
    expect(await accountRoom(projects, storage, 1, a)).toBeLessThan(0);
    const init = vi.spyOn(storage, 'init');
    await expect(capped.projects.create(ana, 'C')).rejects.toMatchObject(over);
    expect(init).not.toHaveBeenCalled();
    expect(await projects.ownedIds(ana.id)).toEqual([a.id]);
  });

  it('re-checks the account after writing: concurrent writes that fit alone do not all pass', async () => {
    const capped = make(1);
    const refused = (results: PromiseSettledResult<unknown>[]) =>
      results.filter((r) => r.status === 'rejected').map((r) => (r.reason as Error).message);

    // Uploads into two projects of one owner: each read the whole room before streaming.
    const a = await capped.projects.create(ana, 'A');
    const b = await capped.projects.create(ana, 'B');
    const uploads = await Promise.allSettled([
      capped.files.upload(a, parts('', { 'a.png': big })),
      capped.files.upload(b, parts('', { 'b.png': big })),
    ]);
    expect(refused(uploads)).not.toHaveLength(0);
    expect(refused(uploads).every((m) => m === over.message)).toBe(true);
    const kept = await Promise.all([
      storage.open(a.id).isFile('a.png'),
      storage.open(b.id).isFile('b.png'),
    ]);
    expect(kept.filter(Boolean).length).toBeLessThanOrEqual(1);

    // Imports: both are written before either row exists (held here so the race is certain).
    const insert = projects.create.bind(projects);
    let release = () => {};
    const both = new Promise<void>((resolve) => {
      release = resolve;
    });
    let arrived = 0;
    projects.create = async (project, ownerId) => {
      if (++arrived === 2) release();
      await both;
      return insert(project, ownerId);
    };
    const imports = await Promise.allSettled([
      capped.projects.import(bob, parts('C', { 'c.tex': big })),
      capped.projects.import(bob, parts('D', { 'd.tex': big })),
    ]);
    expect(refused(imports)).not.toHaveLength(0);
    expect((await projects.ownedIds(bob.id)).length).toBeLessThanOrEqual(1);
  });

  it('walks only the written project for the account quota, its siblings come from a cache', async () => {
    const capped = make(1);
    const a = await capped.projects.create(ana, 'A');
    await capped.projects.create(ana, 'B');
    const listed = vi.spyOn(GitRepository.prototype, 'listFiles');
    try {
      await capped.files.create(a, ana, 'x.tex', 'x');
      const dirs = listed.mock.contexts.map((repo) => (repo as unknown as { dir: string }).dir);
      expect(dirs.length).toBeGreaterThan(0);
      expect(dirs.every((d) => d.endsWith(a.id))).toBe(true);
    } finally {
      listed.mockRestore();
    }
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
