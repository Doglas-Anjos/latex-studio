import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AppConfig } from '@latex-studio/core';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeDocumentSync } from '../../collab/testing/fake-document-sync';
import { ProjectLock } from '../../projects/application/project-lock';
import type { Project } from '../../projects/domain/project';
import { FsProjectStorage } from '../../projects/infrastructure/fs-project-storage';
import type { User } from '../../users/domain/user';
import { HistoryService } from './history.service';

const ana: User = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'ana@example.com',
  name: 'Ana',
  role: 'user',
  status: 'active',
  createdAt: new Date(),
};
const project = { id: '00000000-0000-4000-8000-0000000000aa' } as Project;
const text = (b: Uint8Array) => Buffer.from(b).toString();

describe('HistoryService', () => {
  let dir: string;
  let storage: FsProjectStorage;
  let service: HistoryService;
  let sync: FakeDocumentSync;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'history-'));
    storage = new FsProjectStorage({
      REPOS_DIR: dir,
      BUILDS_DIR: join(dir, 'builds'),
    } as AppConfig);
    sync = new FakeDocumentSync();
    service = new HistoryService(storage, new ProjectLock(), sync);
    await storage.init(project.id);
  });

  afterEach(() => rm(dir, { recursive: true, force: true }));

  it('lists commits and changes, restores an old version, rejects empty commits', async () => {
    const files = storage.open(project.id);
    await files.write('a.tex', 'one');
    const first = (await service.commit(project, ana, 'v1')).sha;
    await files.write('a.tex', 'second');
    const second = (await service.commit(project, ana, 'v2')).sha;

    expect(await service.log(project)).toHaveLength(2);
    expect(await service.changes(project, first, second)).toEqual([
      { path: 'a.tex', type: 'modify' },
    ]);
    expect(() => service.changes(project, 'nope', second)).toThrow(BadRequestException);

    await expect(service.commit(project, ana, 'again')).rejects.toBeInstanceOf(ConflictException);

    const { sha } = await service.restore(project, ana, first, 'a.tex');
    expect(text(await files.repo.readFile('a.tex'))).toBe('one');
    expect(sync.texts.get('a.tex')).toBe('one');
    expect(text(await service.fileAt(project, sha, 'a.tex'))).toBe('one');
    expect(await service.log(project)).toHaveLength(3);
  });
});
