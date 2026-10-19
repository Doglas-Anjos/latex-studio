import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AppConfig } from '@latex-studio/core';
import { PayloadTooLargeException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { IdentityService } from '../../auth/application/identity.service';
import type { TokenVerifier } from '../../auth/domain/token-verifier';
import { LanService } from '../../lan/application/lan.service';
import { LanTokenService } from '../../lan/application/lan-token.service';
import { FakeLan } from '../../lan/testing/fake-lan.repository';
import { ProjectLock } from '../../projects/application/project-lock';
import { FsProjectStorage } from '../../projects/infrastructure/fs-project-storage';
import { FakeProjects } from '../../projects/testing/fake-project.repository';
import { FakeUsers } from '../../users/testing/fake-user.repository';
import type { YjsDocRepository } from '../domain/yjs-doc.repository';
import { allowedOrigin, CollabService, MAX_DOC_CHARS } from './collab.service';

const ORIGIN = 'https://latex.example.com';

class FakeDocs implements YjsDocRepository {
  rows = new Map<string, Uint8Array>();
  load = async (p: string, path: string) => this.rows.get(`${p}/${path}`) ?? null;
  save = async (p: string, path: string, s: Uint8Array) => void this.rows.set(`${p}/${path}`, s);
  deleteForPath = async (p: string, path: string) => void this.rows.delete(`${p}/${path}`);
}

describe('CollabService', () => {
  let dir: string;
  let projects: FakeProjects;
  let users: FakeUsers;
  let docs: FakeDocs;
  let storage: FsProjectStorage;
  let lock: ProjectLock;
  let collab: CollabService;
  let projectId: string;

  /** A token the fake verifier maps to a fresh user with the given project role. */
  const login = async (role: 'owner' | 'viewer' | null) => {
    const subject = randomUUID();
    const user = await users.upsert({
      issuer: 'i',
      subject,
      email: `${subject}@example.com`,
      name: 'U',
    });
    if (role) projects.members.push({ projectId, userId: user.id, role });
    return subject;
  };

  const auth = (token: string, origin = ORIGIN) =>
    collab.authenticate({
      token,
      origin,
      host: 'latex.example.com',
      remoteIp: '203.0.113.7',
      documentName: `${projectId}/main.tex`,
    });

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'collab-'));
    const config = { REPOS_DIR: dir, APP_URL: `${ORIGIN}/` } as AppConfig;
    projects = new FakeProjects();
    users = new FakeUsers();
    docs = new FakeDocs();
    storage = new FsProjectStorage(config);
    const verifier: TokenVerifier = {
      verify: async (token) => {
        const row = users.rows.find((u) => u.subject === token);
        return row ? { identity: row, expiresAt: Date.now() / 1000 + 60 } : null;
      },
    };
    const identity = new IdentityService(users, verifier);
    lock = new ProjectLock();
    collab = new CollabService(identity, projects, storage, docs, lock, config);
    projectId = randomUUID();
    await projects.create({ id: projectId, name: 'P' }, randomUUID());
    const files = await storage.init(projectId);
    await files.write('main.tex', 'documentclass{article}');
  });

  afterEach(() => rm(dir, { recursive: true, force: true }));

  it('accepts an editor and rejects a wrong origin, a bad token or a non-member', async () => {
    const token = await login('owner');
    await expect(auth(token)).resolves.toMatchObject({ path: 'main.tex', readOnly: false });
    await expect(auth(token, 'https://evil.example.com')).rejects.toThrow();
    await expect(auth('forged')).rejects.toThrow();
    await expect(auth('')).rejects.toThrow();
    await expect(auth(await login(null))).rejects.toThrow();
    await expect(
      collab.authenticate({
        token,
        origin: ORIGIN,
        host: 'latex.example.com',
        remoteIp: '203.0.113.7',
        documentName: `${projectId}/a.png`,
      }),
    ).rejects.toThrow();
  });

  it('lets a LAN guest edit from the LAN origin, only with LAN share on and a matching Host', async () => {
    const lanTokens = new LanTokenService({ LAN_SHARE: true, LAN_SECRET: 'x'.repeat(32) });
    lanTokens.setRemote(true);
    const lan = new LanService(new FakeLan(), users, lanTokens);
    const identity = new IdentityService(users, undefined, lanTokens);
    const service = (LAN_SHARE: boolean) =>
      new CollabService(
        identity,
        projects,
        storage,
        docs,
        lock,
        {
          APP_URL: 'http://localhost:5175/',
          LAN_SHARE,
        } as AppConfig,
        lan,
      );
    await lan.publish(projectId);
    const { pin } = await lan.createAccess(projectId, 'Gus');
    const token = (await lan.join(projectId, pin, '192.168.0.9'))?.token ?? '';
    const lanAuth = (s: CollabService, host: string) =>
      s.authenticate({
        token,
        origin: 'http://192.168.0.5:5175',
        host,
        remoteIp: '192.168.0.9',
        documentName: `${projectId}/main.tex`,
      });
    // Not a member: editor through lan.roleOf, so the session is writable.
    await expect(lanAuth(service(true), '192.168.0.5:5175')).resolves.toMatchObject({
      readOnly: false,
    });
    await expect(lanAuth(service(true), 'localhost:3001')).rejects.toThrow('Bad origin');
    await expect(lanAuth(service(false), '192.168.0.5:5175')).rejects.toThrow('Bad origin');

    // Re-checked once the connection is registered: a revoke that ran mid-connect still lands.
    const { user: guest } = await lanAuth(service(true), '192.168.0.5:5175');
    const doc = `${projectId}/main.tex`;
    expect(await service(true).stillAllowed(guest, doc)).toBe(true);
    lanTokens.setRemote(false);
    expect(await service(true).stillAllowed(guest, doc)).toBe(false);
    // Anyone else is not re-checked (the LAN revoke paths are the only ones that race).
    expect(await service(true).stillAllowed({ ...guest, issuer: 'local' }, doc)).toBe(true);
  });

  it('refuses a non-canonical (uppercase) project id', () => {
    expect(() => collab.parseDocumentName(`${projectId.toUpperCase()}/main.tex`)).toThrow();
    expect(collab.parseDocumentName(`${projectId}/main.tex`).projectId).toBe(projectId);
  });

  it('makes viewers read-only', async () => {
    await expect(auth(await login('viewer'))).resolves.toMatchObject({ readOnly: true });
  });

  it('loads the file when no state is saved, and refuses a missing file', async () => {
    expect(await collab.load(projectId, 'main.tex')).toBe('documentclass{article}');
    await expect(collab.load(projectId, 'missing.tex')).rejects.toThrow();
    await storage.open(projectId).write('big.tex', 'a'.repeat(MAX_DOC_CHARS + 1));
    await expect(collab.load(projectId, 'big.tex')).rejects.toBeInstanceOf(
      PayloadTooLargeException,
    );
  });

  it('stores the state and writes the file without committing it', async () => {
    const doc = new Y.Doc();
    doc.getText('content').insert(0, 'hello');
    await collab.store(projectId, 'main.tex', doc);

    expect(await readFile(join(dir, projectId, 'main.tex'), 'utf8')).toBe('hello');
    expect(await storage.open(projectId).repo.head()).toBeNull();
    const loaded = new Y.Doc();
    Y.applyUpdate(loaded, (await collab.load(projectId, 'main.tex')) as Uint8Array);
    expect(loaded.getText('content').toString()).toBe('hello');
  });

  it('snapshots the doc when its lock turn actually runs, not when store was called', async () => {
    const doc = new Y.Doc();
    doc.getText('content').insert(0, 'A');

    // Occupy the project's lock first, exactly like a `commitFile` already running: `store`'s own
    // `lock.run` call has to queue behind it and wait its turn.
    let release = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const blocker = lock.run(projectId, () => gate);

    const storeDone = collab.store(projectId, 'main.tex', doc);

    // Edited after `store` was called but before its turn runs: a snapshot taken eagerly at call
    // time (the old bug) would miss this and persist the stale "A" once the lock finally frees up.
    doc.getText('content').insert(1, 'B');

    release();
    await blocker;
    await storeDone;

    expect(await readFile(join(dir, projectId, 'main.tex'), 'utf8')).toBe('AB');
    const loaded = new Y.Doc();
    Y.applyUpdate(loaded, (await collab.load(projectId, 'main.tex')) as Uint8Array);
    expect(loaded.getText('content').toString()).toBe('AB');
  });

  it('skips a store whose doc was dropped while it waited for the lock', async () => {
    const doc = new Y.Doc();
    doc.getText('content').insert(0, 'old text');
    let release = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    // An upload holds the lock, writes the new file and drops the doc (over the size cap).
    const upload = lock.run(projectId, async () => {
      await gate;
      await storage.open(projectId).write('main.tex', 'uploaded');
      doc.destroy();
    });
    const storeDone = collab.store(projectId, 'main.tex', doc);
    release();
    await upload;
    expect(await storeDone).toBe(0);
    expect(await readFile(join(dir, projectId, 'main.tex'), 'utf8')).toBe('uploaded');
  });
});

describe('allowedOrigin', () => {
  const app = 'http://localhost:5175/';
  const lan = 'http://192.168.0.5:5175';

  it('allows the app origin, and the LAN origin only with LAN share on and a matching Host', () => {
    expect(allowedOrigin('http://localhost:5175', 'localhost:5175', app, false)).toBe(true);
    expect(allowedOrigin(lan, '192.168.0.5:5175', app, true)).toBe(true);
    expect(allowedOrigin(lan, '192.168.0.5:5175', app, false)).toBe(false);
    expect(allowedOrigin(lan, undefined, app, true)).toBe(false);
  });

  it('refuses a foreign site and a missing or malformed origin', () => {
    expect(allowedOrigin('https://evil.example.com', '192.168.0.5:5175', app, true)).toBe(false);
    expect(allowedOrigin(undefined, '192.168.0.5:5175', app, true)).toBe(false);
    expect(allowedOrigin('null', 'null', app, true)).toBe(false);
    expect(allowedOrigin('not a url', 'not a url', app, true)).toBe(false);
  });
});
