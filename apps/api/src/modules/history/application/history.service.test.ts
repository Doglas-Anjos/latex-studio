import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AppConfig } from '@latex-studio/core';
import { AUTOSAVE_AUTHOR, AUTOSAVE_MESSAGE } from '@latex-studio/git-store';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { IdentityService } from '../../auth/application/identity.service';
import { CollabService } from '../../collab/application/collab.service';
import type { YjsDocRepository } from '../../collab/domain/yjs-doc.repository';
import { createHocuspocus } from '../../collab/infrastructure/hocuspocus.server';
import { HocuspocusDocumentSync } from '../../collab/infrastructure/hocuspocus-document-sync';
import { FakeDocumentSync } from '../../collab/testing/fake-document-sync';
import { ProjectLock } from '../../projects/application/project-lock';
import type { Project } from '../../projects/domain/project';
import { FsProjectStorage } from '../../projects/infrastructure/fs-project-storage';
import { FakeProjects } from '../../projects/testing/fake-project.repository';
import type { User } from '../../users/domain/user';
import { HistoryService } from './history.service';

const ana: User = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'ana@example.com',
  name: 'Ana',
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

  it('flushes every open doc before a full commit, not before a path commit', async () => {
    await storage.open(project.id).write('a.tex', 'one');
    await service.commit(project, ana, 'v1');
    expect(sync.calls).toEqual(['flushProject']);
    await storage.open(project.id).write('a.tex', 'two-longer');
    await service.commit(project, ana, 'v2', ['a.tex']);
    expect(sync.calls).toEqual(['flushProject', 'flush a.tex']);
  });

  it('reports status against the last named commit and blames uncommitted lines', async () => {
    const files = storage.open(project.id);
    await files.write('a.tex', 'one\n');
    await service.commit(project, ana, 'v1');
    const v1 = (await service.log(project))[0]?.sha;
    await files.write('a.tex', 'one\ntwo\n');
    await files.repo.commitAll(AUTOSAVE_MESSAGE, AUTOSAVE_AUTHOR);
    await files.write('a.tex', 'one\ntwo\nthree\n');

    const status = await service.status(project);
    expect(status.baseline?.sha).toBe(v1);
    expect(status.changes).toEqual([{ path: 'a.tex', type: 'modify' }]);

    const { lines } = await service.blame(project, 'a.tex');
    expect(lines.map((l) => [l.from, l.to, l.sha === null])).toEqual([
      [1, 1, false],
      [2, 2, false],
      [3, 3, true],
    ]);
    await expect(service.blame(project, '')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('commits only the given path, flushing the open doc first, with a default message', async () => {
    const files = storage.open(project.id);
    await files.write('a.tex', 'one');
    await files.write('b.tex', 'one');
    await service.commit(project, ana, 'v1');

    // Different sizes: statusMatrix misses a same-size edit within the same second.
    await files.write('a.tex', 'two-longer');
    await files.write('b.tex', 'two-longer');
    const { sha } = await service.commitFile(project, ana, 'a.tex', '  ');

    expect(sync.calls).toContain('flush a.tex');
    const [head] = await service.log(project);
    expect(head?.sha).toBe(sha);
    expect(head?.message).toBe('Update a.tex');
    expect(await service.changes(project, (await service.log(project))[1]?.sha ?? '', sha)).toEqual(
      [{ path: 'a.tex', type: 'modify' }],
    );
    expect(await service.status(project)).toMatchObject({
      changes: [{ path: 'b.tex', type: 'modify' }],
    });

    await expect(service.commitFile(project, ana, 'a.tex')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('fileLog lists only the commits that touched the path', async () => {
    const files = storage.open(project.id);
    await files.write('a.tex', '1');
    await files.write('b.tex', '1');
    await service.commit(project, ana, 'first');
    // Different sizes: statusMatrix misses a same-size edit within the same second.
    await files.write('b.tex', '22');
    await service.commit(project, ana, 'second');

    expect((await service.fileLog(project, 'a.tex')).map((c) => c.message)).toEqual(['first']);
    expect((await service.fileLog(project, 'b.tex')).map((c) => c.message)).toEqual([
      'second',
      'first',
    ]);
    expect(() => service.fileLog(project, '')).toThrow(BadRequestException);
    expect(() => service.fileLog(project, '../nope')).toThrow(BadRequestException);
  });
});

/** Minimal in-memory YjsDocRepository, mirroring the Drizzle-backed one's contract. */
class FakeYjsDocs implements YjsDocRepository {
  rows = new Map<string, Uint8Array>();
  load = async (projectId: string, path: string) => this.rows.get(`${projectId}/${path}`) ?? null;
  save = async (projectId: string, path: string, state: Uint8Array) =>
    void this.rows.set(`${projectId}/${path}`, state);
  deleteForPath = async (projectId: string, path: string) =>
    void this.rows.delete(`${projectId}/${path}`);
}

describe('HistoryService.commitFile against the real collaborative stack', () => {
  let dir: string;
  let storage: FsProjectStorage;
  let lock: ProjectLock;
  let service: HistoryService;
  let hocuspocus: ReturnType<typeof createHocuspocus>;
  let collab: CollabService;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'history-collab-'));
    storage = new FsProjectStorage({
      REPOS_DIR: dir,
      BUILDS_DIR: join(dir, 'builds'),
    } as AppConfig);
    await storage.init(project.id);

    // Same ProjectLock instance as HistoryService, exactly as the real CollabModule/HistoryModule
    // wiring shares one lock per project: this is what makes the CollabService.store re-entrancy
    // deadlock reproducible if HocuspocusDocumentSync.flush ever goes back through it.
    lock = new ProjectLock();
    const projects = new FakeProjects();
    const docsRepo = new FakeYjsDocs();
    collab = new CollabService(
      {} as unknown as IdentityService,
      projects,
      storage,
      docsRepo,
      lock,
      {} as unknown as AppConfig,
    );
    hocuspocus = createHocuspocus(collab);
    const sync = new HocuspocusDocumentSync(hocuspocus, docsRepo, storage, projects);
    service = new HistoryService(storage, lock, sync);
  });

  afterEach(async () => {
    // Drain any pending debounced store left over from a test so it doesn't fire after teardown.
    await Promise.all(
      [...hocuspocus.documents.keys()].map((name) =>
        hocuspocus.debouncer.executeNow(`onStoreDocument-${name}`),
      ),
    );
    await rm(dir, { recursive: true, force: true });
  });

  it('commits a just-typed live edit without deadlocking, leaving unrelated files uncommitted', async () => {
    const files = storage.open(project.id);
    await files.write('a.tex', 'one');
    await files.write('b.tex', 'one');
    await service.commit(project, ana, 'v1');

    // Open 'a.tex' collaboratively, exactly as a connected editor would via the websocket upgrade.
    const name = `${project.id}/a.tex`;
    const doc = await hocuspocus.createDocument(
      name,
      new Request('http://localhost/'),
      'socket-1',
      {
        isAuthenticated: true,
        readOnly: false,
      },
    );
    expect(doc.getText('content').toString()).toBe('one');

    // A just-typed edit: Hocuspocus schedules a debounced onStoreDocument that would normally wait
    // out the 2-10s debounce before writing the working tree and, through it, re-entering the same
    // ProjectLock that `commitFile` below already holds. The local origin's `context.user` stands
    // in for the connection context a real editor's websocket would carry.
    doc.transact(() => doc.getText('content').insert(doc.getText('content').length, '-live-edit'), {
      source: 'local',
      context: { user: ana },
    });
    expect(hocuspocus.debouncer.isDebounced(`onStoreDocument-${name}`)).toBe(true);

    // An unrelated, uncommitted change to a file that was never opened collaboratively.
    await files.write('b.tex', 'two-longer');

    const commitFile = service.commitFile(project, ana, 'a.tex');
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('commitFile deadlocked')), 2000),
    );
    const { sha } = (await Promise.race([commitFile, timeout])) as { sha: string };

    // The committed blob holds the live edit, not the on-disk text from before the edit.
    expect(text(await service.fileAt(project, sha, 'a.tex'))).toBe('one-live-edit');
    expect(text(await files.repo.readFile('a.tex'))).toBe('one-live-edit');

    const [head] = await service.log(project);
    expect(head?.sha).toBe(sha);
    expect(await service.changes(project, (await service.log(project))[1]?.sha ?? '', sha)).toEqual(
      [{ path: 'a.tex', type: 'modify' }],
    );
    // b.tex's unrelated change is untouched by commitFile.
    expect(await service.status(project)).toMatchObject({
      changes: [{ path: 'b.tex', type: 'modify' }],
    });
  });

  it('a store already in flight when commitFile runs never rewrites the commit back to a stale snapshot', async () => {
    const files = storage.open(project.id);
    await files.write('a.tex', 'one');
    await service.commit(project, ana, 'v1');

    const name = `${project.id}/a.tex`;
    const doc = await hocuspocus.createDocument(
      name,
      new Request('http://localhost/'),
      'socket-1',
      { isAuthenticated: true, readOnly: false },
    );
    doc.transact(() => doc.getText('content').insert(doc.getText('content').length, '-A'), {
      source: 'local',
      context: { user: ana },
    });

    // Occupy the project lock so neither commitFile nor the store below can run yet; this lets
    // the test control exactly which turn each takes, instead of racing against real debounce
    // timers.
    let release = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const blocker = lock.run(project.id, () => gate);

    // commitFile ("Ctrl+S") queues for the next turn...
    const commitPromise = service.commitFile(project, ana, 'a.tex');
    // ...and a store call -- standing in for Hocuspocus firing the doc's debounced
    // `onStoreDocument` while commitFile is already ahead of it in line -- queues behind it.
    const storeDone = collab.store(project.id, 'a.tex', doc);
    // Let a pending `store`'s pre-lock snapshot (the bug this guards against) settle before the
    // next edit lands, so a buggy implementation would freeze it as stale right here.
    await Promise.resolve();
    await Promise.resolve();

    // More typing while both commitFile and store sit queued behind the blocker.
    doc.transact(() => doc.getText('content').insert(doc.getText('content').length, '-B'), {
      source: 'local',
      context: { user: ana },
    });

    release();
    await blocker;
    const { sha } = await commitPromise;
    await storeDone;

    // The commit, and the working tree it left behind, hold the full live edit -- the delayed
    // store must not have rewritten it back to the pre-"-B" snapshot once it finally got its turn.
    expect(text(await service.fileAt(project, sha, 'a.tex'))).toBe('one-A-B');
    expect(text(await files.repo.readFile('a.tex'))).toBe('one-A-B');
    expect(await service.status(project)).toMatchObject({ changes: [] });
  });
});
