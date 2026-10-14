import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { buffer } from 'node:stream/consumers';
import type { AppConfig } from '@latex-studio/core';
import { NotFoundException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeDocumentSync } from '../../collab/testing/fake-document-sync';
import type { UploadPart } from '../../projects/application/project-files';
import { ProjectLock } from '../../projects/application/project-lock';
import type { Project } from '../../projects/domain/project';
import { FsProjectStorage } from '../../projects/infrastructure/fs-project-storage';
import { FakeProjects } from '../../projects/testing/fake-project.repository';
import type { User } from '../../users/domain/user';
import { FilesService } from './files.service';

const ana = { id: 'u1', email: 'ana@example.com', name: 'Ana', createdAt: new Date() } as User;
const project = { id: '00000000-0000-4000-8000-0000000000bb' } as Project;

async function* parts(files: Record<string, string>): AsyncIterable<UploadPart> {
  for (const [filename, content] of Object.entries(files)) {
    const buffer = Buffer.from(content);
    yield {
      type: 'file',
      fieldname: 'files',
      filename,
      file: Readable.from([buffer]),
      toBuffer: async () => buffer,
    };
  }
}

describe('FilesService', () => {
  let dir: string;
  let storage: FsProjectStorage;
  let sync: FakeDocumentSync;
  let service: FilesService;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'files-'));
    const config = { REPOS_DIR: dir, BUILDS_DIR: join(dir, 'b'), PROJECT_QUOTA_MB: 1 } as AppConfig;
    storage = new FsProjectStorage(config);
    await storage.init(project.id);
    sync = new FakeDocumentSync();
    service = new FilesService(storage, new ProjectLock(), config, sync, new FakeProjects());
  });

  afterEach(() => rm(dir, { recursive: true, force: true }));

  it('streams a file with its size and answers 404 for a folder', async () => {
    await service.create(project, ana, 'dir/a.tex', 'hello');
    const { stream, size } = await service.read(project, 'dir/a.tex');
    expect(size).toBe(5);
    expect((await buffer(stream)).toString()).toBe('hello');
    await expect(service.read(project, 'dir')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('patches the collaborative doc of every uploaded text file, not binaries', async () => {
    await storage.open(project.id).write('main.tex', 'old');
    const written = await service.upload(
      project,
      parts({ 'main.tex': 'new upload', 'refs.BIB': '@book{x}', 'fig.png': 'png' }),
    );
    expect(written.map((w) => w.path).sort()).toEqual(['fig.png', 'main.tex', 'refs.BIB']);
    expect(sync.calls.sort()).toEqual(['replace main.tex', 'replace refs.BIB']);
    expect(sync.texts.get('main.tex')).toBe('new upload');
  });

  it('leaves an upload over an existing file as a working change, not a commit', async () => {
    // Different sizes: isomorphic-git's WORKDIR skips hashing a same-size file written in the
    // same second as the commit (real uploads come long after the saved version).
    await service.create(project, ana, 'cap.tex', 'old');
    const repo = storage.open(project.id).repo;
    const saved = await repo.head();
    await service.upload(project, parts({ 'cap.tex': 'new text', 'sub/new.tex': 'x' }));
    expect(await repo.head()).toBe(saved);
    expect(await repo.workingChanges(saved)).toEqual(
      expect.arrayContaining([
        { path: 'cap.tex', type: 'modify' },
        { path: 'sub/new.tex', type: 'add' },
      ]),
    );
  });

  it('tells new, changed and byte-identical uploads apart, and leaves identical docs alone', async () => {
    await service.create(project, ana, 'same.tex', 'kept');
    await service.create(project, ana, 'edit.tex', 'before');
    const result = await service.upload(
      project,
      parts({ 'same.tex': 'kept', 'edit.tex': 'aft3r!', 'new.tex': 'x' }),
    );
    expect(Object.fromEntries(result.map((r) => [r.path, r.change]))).toEqual({
      'same.tex': 'same',
      'edit.tex': 'modify',
      'new.tex': 'add',
    });
    expect(sync.calls).not.toContain('replace same.tex');
  });

  it("refuses an update or a new folder that the owner's account cannot hold", async () => {
    const projects = new FakeProjects();
    const owned = await projects.create({ id: project.id, name: 'P' }, ana.id);
    const other = await projects.create(
      { id: '00000000-0000-4000-8000-0000000000bc', name: 'Q' },
      ana.id,
    );
    const config = {
      REPOS_DIR: dir,
      BUILDS_DIR: join(dir, 'b'),
      PROJECT_QUOTA_MB: 10,
      USER_QUOTA_MB: 1,
    } as AppConfig;
    const capped = new FilesService(storage, new ProjectLock(), config, sync, projects);
    // Ana's other project holds 700 KB of her 1 MB.
    await (await storage.init(other.id)).write('fill.bin', new Uint8Array(700 * 1024));
    await capped.create(owned, ana, 'a.tex', 'small');
    const over = /^Cota de armazenamento/;
    await expect(capped.update(owned, ana, 'a.tex', 'x'.repeat(400 * 1024))).rejects.toThrow(over);
    await storage.open(project.id).write('fig.png', new Uint8Array(400 * 1024));
    await expect(capped.createFolder(owned, ana, 'dir')).rejects.toThrow(over);
    expect(await storage.open(project.id).isFile('dir/.keep')).toBe(false);
  });

  it('charges each file at least 4 KiB, so empty files cannot fill the disk for free', async () => {
    const empty = Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`e${i}.tex`, '']));
    // 300 × 4 KiB is over the 1 MB quota; the files written before the refusal are removed.
    await expect(service.upload(project, parts(empty))).rejects.toMatchObject({ status: 413 });
    expect(await storage.open(project.id).repo.listFiles()).toEqual([]);
  });

  it('forgets the docs of renamed and deleted files', async () => {
    await service.create(project, ana, 'a.tex', 'a');
    await service.create(project, ana, 'dir/b.tex', 'b');
    await service.rename(project, ana, 'a.tex', 'c.tex');
    await service.remove(project, ana, 'dir');
    expect(sync.calls).toEqual(['forget a.tex', 'forget dir/b.tex']);
  });

  it('commits only the paths a file operation touches, leaving other edits pending', async () => {
    await service.create(project, ana, 'a.tex', 'a');
    await service.create(project, ana, 'dir/b.tex', 'b');
    await service.create(project, ana, 'other.tex', 'o');
    await storage.open(project.id).write('other.tex', 'edited, not committed');

    await service.rename(project, ana, 'dir', 'moved');
    await service.remove(project, ana, 'a.tex');

    const repo = storage.open(project.id).repo;
    const head = (await repo.head()) as string;
    expect(await repo.workingChanges(head)).toEqual([{ path: 'other.tex', type: 'modify' }]);
    expect(await repo.readFileAt(head, 'moved/b.tex', 10)).not.toBeNull();
    expect(await repo.readFileAt(head, 'dir/b.tex', 10)).toBeNull();
    expect(await repo.readFileAt(head, 'a.tex', 10)).toBeNull();
  });
});
