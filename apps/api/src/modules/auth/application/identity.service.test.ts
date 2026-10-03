import { describe, expect, it, vi } from 'vitest';
import { FakeUsers } from '../../users/testing/fake-user.repository';
import type { TokenVerifier } from '../domain/token-verifier';
import { bearerToken, IdentityService, LOCAL_IDENTITY } from './identity.service';

const ana = {
  issuer: 'https://fasorx.example',
  subject: 'u-1',
  email: 'ana@example.com',
  name: 'Ana',
};

describe('IdentityService', () => {
  it('is the local user for every request when no verifier is configured', async () => {
    const users = new FakeUsers();
    const identity = new IdentityService(users);
    const user = await identity.resolve(null, 'localhost:3001');
    expect(user?.email).toBe(LOCAL_IDENTITY.email);
    expect((await identity.resolve('anything', '127.0.0.1'))?.id).toBe(user?.id);
    expect(await identity.resolve(null, 'latex.example.com')).toBeNull();
    expect(await identity.resolve(null, undefined)).toBeNull();
    expect(users.rows).toHaveLength(1);
  });

  it('verifies the token once per lifetime, upserting the user, and refuses bad ones', async () => {
    const users = new FakeUsers();
    const verify = vi.fn(async (token: string) =>
      token === 'good' ? { identity: ana, expiresAt: Date.now() / 1000 + 300 } : null,
    );
    const verifier: TokenVerifier = { verify };
    const identity = new IdentityService(users, verifier);
    const host = 'latex.example.com';
    expect(await identity.resolve(null, host)).toBeNull();
    expect(await identity.resolve('bad', host)).toBeNull();
    const user = await identity.resolve('good', host);
    expect(user?.email).toBe('ana@example.com');
    expect((await identity.resolve('good', host))?.id).toBe(user?.id);
    expect(verify).toHaveBeenCalledTimes(2);
    expect(users.rows).toHaveLength(1);
  });

  it('reads the bearer token from the header', () => {
    expect(bearerToken('Bearer abc')).toBe('abc');
    expect(bearerToken('bearer abc')).toBe('abc');
    expect(bearerToken('Basic abc')).toBeNull();
    expect(bearerToken('Bearer ')).toBeNull();
    expect(bearerToken(undefined)).toBeNull();
  });
});
