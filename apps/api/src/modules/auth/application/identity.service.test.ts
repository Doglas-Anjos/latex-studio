import { describe, expect, it, vi } from 'vitest';
import { LanTokenService } from '../../lan/application/lan-token.service';
import { LAN_ISSUER } from '../../users/domain/user';
import { FakeUsers } from '../../users/testing/fake-user.repository';
import type { TokenVerifier } from '../domain/token-verifier';
import {
  bearerToken,
  IdentityService,
  LOCAL_IDENTITY,
  peerIp,
  rateLimitKey,
} from './identity.service';

const ana = {
  issuer: 'https://fasorx.example',
  subject: 'u-1',
  email: 'ana@example.com',
  name: 'Ana',
};

describe('IdentityService', () => {
  it('is the local user for a loopback request when no verifier is configured', async () => {
    const users = new FakeUsers();
    const identity = new IdentityService(users);
    const user = await identity.resolve(null, 'localhost:3001', '127.0.0.1');
    expect(user?.email).toBe(LOCAL_IDENTITY.email);
    expect((await identity.resolve('anything', '127.0.0.1', '::1'))?.id).toBe(user?.id);
    expect(await identity.resolve(null, 'latex.example.com', '127.0.0.1')).toBeNull();
    expect(await identity.resolve(null, undefined, '127.0.0.1')).toBeNull();
    // A LAN peer spoofing Host: localhost is refused: its socket address is not loopback.
    expect(await identity.resolve(null, 'localhost:3001', '192.168.0.9')).toBeNull();
    expect(await identity.resolve(null, 'localhost:3001', '')).toBeNull();
    expect(users.rows).toHaveLength(1);
  });

  it('resolves a valid LAN token to its backing user, from any address', async () => {
    const users = new FakeUsers();
    const lanTokens = new LanTokenService({ LAN_SHARE: true, LAN_SECRET: 'x'.repeat(32) });
    const identity = new IdentityService(users, undefined, lanTokens);
    const guest = await users.upsert({
      issuer: LAN_ISSUER,
      subject: 's-1',
      email: 'lan+s-1@localhost',
      name: 'Gus',
    });
    const token = (await lanTokens.sign(guest.id)) ?? '';
    expect(await identity.resolve(token, '192.168.0.5:5175', '192.168.0.9')).toBe(guest);
    // A forged token falls through to local mode, which a LAN peer never passes.
    expect(await identity.resolve('forged', '192.168.0.5:5175', '192.168.0.9')).toBeNull();
    // A validly signed token naming a non-LAN account (the host's) is refused, even from loopback.
    const host = await users.upsert(LOCAL_IDENTITY);
    const asHost = (await lanTokens.sign(host.id)) ?? '';
    expect(await identity.resolve(asHost, 'localhost:5175', '127.0.0.1')).toBeNull();
  });

  it('verifies the token once per lifetime, upserting the user, and refuses bad ones', async () => {
    const users = new FakeUsers();
    const verify = vi.fn(async (token: string) =>
      token === 'good' ? { identity: ana, expiresAt: Date.now() / 1000 + 300 } : null,
    );
    const verifier: TokenVerifier = { verify };
    const identity = new IdentityService(users, verifier);
    const host = 'latex.example.com';
    const ip = '203.0.113.7';
    expect(await identity.resolve(null, host, ip)).toBeNull();
    expect(await identity.resolve('bad', host, ip)).toBeNull();
    const user = await identity.resolve('good', host, ip);
    expect(user?.email).toBe('ana@example.com');
    expect((await identity.resolve('good', host, ip))?.id).toBe(user?.id);
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
    await identity.resolve('good', 'latex.example.com', '10.0.0.1');
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

  it('takes the client address from the proxy-appended X-Forwarded-For entry only', () => {
    // A LAN peer forging loopback in front of the real entry Vite appended: not loopback.
    expect(peerIp('127.0.0.1, 192.168.0.9', '127.0.0.1')).toBe('192.168.0.9');
    // The host's own browser through Vite.
    expect(peerIp('127.0.0.1', '127.0.0.1')).toBe('127.0.0.1');
    // A peer hitting the API directly: its header is ignored, its socket is the address.
    expect(peerIp('127.0.0.1', '192.168.0.9')).toBe('192.168.0.9');
    expect(peerIp(undefined, '::1')).toBe('::1');
  });

  it('reads the bearer token from the header', () => {
    expect(bearerToken('Bearer abc')).toBe('abc');
    expect(bearerToken('bearer abc')).toBe('abc');
    expect(bearerToken('Basic abc')).toBeNull();
    expect(bearerToken('Bearer ')).toBeNull();
    expect(bearerToken(undefined)).toBeNull();
  });
});
