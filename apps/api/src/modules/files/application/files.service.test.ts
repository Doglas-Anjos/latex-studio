import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import type { AppConfig } from '@latex-studio/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeDocumentSync } from '../../collab/testing/fake-document-sync';
import type { UploadPart } from '../../projects/application/project-files';
import { ProjectLock } from '../../projects/application/project-lock';
import type { Project } from '../../projects/domain/project';
import { FsProjectStorage } from '../../projects/infrastructure/fs-project-storage';
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
    service = new FilesService(storage, new ProjectLock(), config, sync);
  });

  afterEach(() => rm(dir, { recursive: true, force: true }));

  it('patches the collaborative doc of every uploaded text file, not binaries', async () => {
    await storage.open(project.id).write('main.tex', 'old');
    const written = await service.upload(
      project,
      parts({ 'main.tex': 'new upload', 'refs.BIB': '@book{x}', 'fig.png': 'png' }),
    );
    expect(written.sort()).toEqual(['fig.png', 'main.tex', 'refs.BIB']);
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

  it('forgets the docs of renamed and deleted files', async () => {
    await service.create(project, ana, 'a.tex', 'a');
    await service.create(project, ana, 'dir/b.tex', 'b');
    await service.rename(project, ana, 'a.tex', 'c.tex');
    await service.remove(project, ana, 'dir');
    expect(sync.calls).toEqual(['forget a.tex', 'forget dir/b.tex']);
  });
});
