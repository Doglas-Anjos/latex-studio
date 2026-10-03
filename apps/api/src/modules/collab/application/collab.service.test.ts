import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sign } from '@fastify/cookie';
import type { AppConfig } from '@latex-studio/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { AuthService } from '../../auth/application/auth.service';
import type { PasswordHasher } from '../../auth/domain/password-hasher';
import type { Session, SessionRepository } from '../../auth/domain/session.repository';
import { ProjectLock } from '../../projects/application/project-lock';
import { FsProjectStorage } from '../../projects/infrastructure/fs-project-storage';
import { FakeProjects } from '../../projects/testing/fake-project.repository';
import type { UserCredentials } from '../../users/domain/user';
import { FakeUsers } from '../../users/testing/fake-user.repository';
import type { YjsDocRepository } from '../domain/yjs-doc.repository';
import { CollabService } from './collab.service';

const SECRET = 'x'.repeat(32);
const ORIGIN = 'https://latex.example.com';

class FakeSessions implements SessionRepository {
  rows: Session[] = [];
  create = async (s: Session) => void this.rows.push(s);
  findByTokenHash = async (h: string) => this.rows.find((s) => s.tokenHash === h) ?? null;
  deleteByTokenHash = async () => {};
  deleteExpired = async () => {};
}

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
  let sessions: FakeSessions;
  let docs: FakeDocs;
  let storage: FsProjectStorage;
  let collab: CollabService;
  let projectId: string;

  const login = async (role: 'owner' | 'viewer' | null) => {
    const user = (await users.create({
      email: `${randomUUID()}@example.com`,
      name: 'U',
      passwordHash: 'h',
    })) as UserCredentials;
    user.status = 'active';
    const token = randomUUID();
    sessions.rows.push({
      tokenHash: createHash('sha256').update(token).digest('hex'),
      userId: user.id,
      expiresAt: new Date(Date.now() + 60_000),
    });
    if (role) projects.members.push({ projectId, userId: user.id, role });
    return `theme=dark; sid=${encodeURIComponent(sign(token, SECRET))}`;
  };

  const auth = (cookieHeader: string | null, origin = ORIGIN) =>
    collab.authenticate({ cookieHeader, origin, documentName: `${projectId}/main.tex` });

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'collab-'));
    const config = { REPOS_DIR: dir, APP_URL: `${ORIGIN}/`, SESSION_SECRET: SECRET } as AppConfig;
    projects = new FakeProjects();
    users = new FakeUsers();
    sessions = new FakeSessions();
    docs = new FakeDocs();
    storage = new FsProjectStorage(config);
    const hasher = { hash: async () => 'h' } as unknown as PasswordHasher;
    const authService = new AuthService(users, sessions, hasher, config);
    collab = new CollabService(authService, projects, storage, docs, new ProjectLock(), config);
    projectId = randomUUID();
    await projects.create({ id: projectId, name: 'P' }, randomUUID());
    const files = await storage.init(projectId);
    await files.write('main.tex', 'documentclass{article}');
  });

  afterEach(() => rm(dir, { recursive: true, force: true }));

  it('accepts an editor and rejects a wrong origin, a bad cookie or a non-member', async () => {
    const cookie = await login('owner');
    await expect(auth(cookie)).resolves.toMatchObject({ path: 'main.tex', readOnly: false });
    await expect(auth(cookie, 'https://evil.example.com')).rejects.toThrow();
    await expect(auth(cookie.replace(/sid=[^;]+/, 'sid=forged.sig'))).rejects.toThrow();
    await expect(auth(null)).rejects.toThrow();
    await expect(auth(await login(null))).rejects.toThrow();
    await expect(
      collab.authenticate({
        cookieHeader: cookie,
        origin: ORIGIN,
        documentName: `${projectId}/a.png`,
      }),
    ).rejects.toThrow();
  });

  it('makes viewers read-only', async () => {
    await expect(auth(await login('viewer'))).resolves.toMatchObject({ readOnly: true });
  });

  it('loads the file when no state is saved, and refuses a missing file', async () => {
    expect(await collab.load(projectId, 'main.tex')).toBe('documentclass{article}');
    await expect(collab.load(projectId, 'missing.tex')).rejects.toThrow();
  });

  it('stores the state, writes the file and marks the project dirty', async () => {
    const doc = new Y.Doc();
    doc.getText('content').insert(0, 'hello');
    await collab.store(projectId, 'main.tex', doc);

    expect(await readFile(join(dir, projectId, 'main.tex'), 'utf8')).toBe('hello');
    expect(projects.dirtySince.has(projectId)).toBe(true);
    const loaded = new Y.Doc();
    Y.applyUpdate(loaded, (await collab.load(projectId, 'main.tex')) as Uint8Array);
    expect(loaded.getText('content').toString()).toBe('hello');
  });
});
