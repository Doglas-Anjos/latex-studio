import { describe, expect, it, vi } from 'vitest';
import { FakeUsers } from '../../users/testing/fake-user.repository';
import type { TokenVerifier } from '../domain/token-verifier';
import { bearerToken, IdentityService, LOCAL_IDENTITY, rateLimitKey } from './identity.service';

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

  it('keys rate limits on the already-verified user, else on the IP (IPv6 by /64)', async () => {
    const verify = vi.fn(async (token: string) =>
      token === 'good' ? { identity: ana, expiresAt: Date.now() / 1000 + 300 } : null,
    );
    const identity = new IdentityService(new FakeUsers(), { verify });
    const req = (authorization?: string, ip = '10.0.0.1') => ({ headers: { authorization }, ip });
    // Before the guard verified it, a token counts against its IP; the key never verifies.
    expect(rateLimitKey(identity, req('Bearer good'))).toBe('10.0.0.1');
    await identity.resolve('good', 'latex.example.com');
    const key = rateLimitKey(identity, req('Bearer good'));
    expect(key).toMatch(/^user:/);
    expect(rateLimitKey(identity, req('Bearer good', '10.0.0.2'))).toBe(key);
    expect(rateLimitKey(identity, req('Bearer forged'))).toBe('10.0.0.1');
    expect(verify).toHaveBeenCalledTimes(1);
    expect(rateLimitKey(identity, req(undefined, '2001:db8:1:2:3:4:5:6'))).toBe('2001:db8:1:2');
    expect(rateLimitKey(identity, req(undefined, '2001:db8::1:2:3:4'))).toBe('2001:db8:0:0');
    expect(rateLimitKey(identity, req(undefined, '2001:db8::5:6:7:8'))).toBe('2001:db8:0:0');
    expect(rateLimitKey(identity, req(undefined, '::1'))).toBe('0:0:0:0');
    expect(rateLimitKey(identity, req(undefined, '::ffff:10.0.0.1'))).toBe('::ffff:10.0.0.1');
  });

  it('reads the bearer token from the header', () => {
    expect(bearerToken('Bearer abc')).toBe('abc');
    expect(bearerToken('bearer abc')).toBe('abc');
    expect(bearerToken('Basic abc')).toBeNull();
    expect(bearerToken('Bearer ')).toBeNull();
    expect(bearerToken(undefined)).toBeNull();
  });
});
