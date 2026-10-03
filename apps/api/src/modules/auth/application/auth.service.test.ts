import { createHash } from 'node:crypto';
import type { AppConfig } from '@latex-studio/core';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { beforeEach, describe, expect, it } from 'vitest';
import type { UserCredentials } from '../../users/domain/user';
import { FakeUsers } from '../../users/testing/fake-user.repository';
import type { PasswordHasher } from '../domain/password-hasher';
import type { Session, SessionRepository } from '../domain/session.repository';
import { AuthService } from './auth.service';

class FakeSessions implements SessionRepository {
  rows: Session[] = [];
  async create(session: Session) {
    this.rows.push(session);
  }
  async findByTokenHash(tokenHash: string) {
    return this.rows.find((s) => s.tokenHash === tokenHash) ?? null;
  }
  async deleteByTokenHash(tokenHash: string) {
    this.rows = this.rows.filter((s) => s.tokenHash !== tokenHash);
  }
  async deleteExpired() {
    this.rows = this.rows.filter((s) => s.expiresAt > new Date());
  }
}

class FakeHasher implements PasswordHasher {
  verified: string[] = [];
  hash = async (password: string) => `hashed:${password}`;
  verify = async (hash: string, password: string) => {
    this.verified.push(hash);
    return hash === `hashed:${password}`;
  };
}

const config = {
  ADMIN_EMAIL: 'Admin@Example.com',
  ADMIN_PASSWORD: 'admin-password-123',
} as AppConfig;
const PASSWORD = 'correct horse battery';

describe('AuthService', () => {
  let users: FakeUsers;
  let sessions: FakeSessions;
  let hasher: FakeHasher;
  let auth: AuthService;

  beforeEach(() => {
    users = new FakeUsers();
    sessions = new FakeSessions();
    hasher = new FakeHasher();
    auth = new AuthService(users, sessions, hasher, config);
  });

  const activeUser = async () => {
    await auth.register('Ana@Example.com', 'Ana', PASSWORD);
    const user = users.rows[0] as UserCredentials;
    user.status = 'active';
    return user;
  };

  it('registers a pending user and silently ignores a taken email', async () => {
    await auth.register(' Ana@Example.com ', 'Ana', PASSWORD);
    expect(users.rows[0]).toMatchObject({
      email: 'ana@example.com',
      status: 'pending',
      passwordHash: `hashed:${PASSWORD}`,
    });
    await expect(auth.register('ana@example.com', 'Other', PASSWORD)).resolves.toBeUndefined();
    expect(users.rows).toHaveLength(1);
  });

  it('rejects a pending user with 403 after a correct password', async () => {
    await auth.register('ana@example.com', 'Ana', PASSWORD);
    await expect(auth.login('ana@example.com', PASSWORD)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('answers 401 for a wrong password or an unknown email, verifying a hash either way', async () => {
    await activeUser();
    await expect(auth.login('ana@example.com', 'wrong-password')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(auth.login('nobody@example.com', PASSWORD)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(hasher.verified).toHaveLength(2);
    expect(sessions.rows).toHaveLength(0);
  });

  it('logs an active user in, storing only the sha256 of the token', async () => {
    const user = await activeUser();
    const { token, user: loggedIn } = await auth.login('ANA@example.com', PASSWORD);

    expect(token).toMatch(/^[\w-]{43}$/); // 32 bytes, base64url
    expect(loggedIn).not.toHaveProperty('passwordHash');
    expect(sessions.rows).toHaveLength(1);
    expect(sessions.rows[0]?.tokenHash).toBe(createHash('sha256').update(token).digest('hex'));
    expect(JSON.stringify(sessions.rows)).not.toContain(token);
    expect((await auth.resolveSession(token))?.id).toBe(user.id);

    await auth.logout(token);
    expect(await auth.resolveSession(token)).toBeNull();
  });

  it('bootstraps one active admin only when none exists and sweeps expired sessions', async () => {
    sessions.rows.push({ tokenHash: 'old', userId: 'x', expiresAt: new Date(0) });
    await auth.onApplicationBootstrap();
    await auth.onApplicationBootstrap();
    expect(users.rows).toHaveLength(1);
    expect(users.rows[0]).toMatchObject({
      email: 'admin@example.com',
      role: 'admin',
      status: 'active',
    });
    expect(sessions.rows).toHaveLength(0);
  });
});
