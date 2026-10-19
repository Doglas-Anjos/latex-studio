import { BadRequestException, HttpException } from '@nestjs/common';
import { beforeEach, describe, expect, it } from 'vitest';
import { FakeUsers } from '../../users/testing/fake-user.repository';
import { FakeLan } from '../testing/fake-lan.repository';
import { LanService, lanOrigins } from './lan.service';
import { LanTokenService } from './lan-token.service';

const P = '00000000-0000-4000-8000-00000000000a';
const wrongOf = (pin: string) => (pin === '0000' ? '0001' : '0000');

describe('LanService', () => {
  let repo: FakeLan;
  let users: FakeUsers;
  let tokens: LanTokenService;
  let service: LanService;
  beforeEach(() => {
    repo = new FakeLan();
    users = new FakeUsers();
    tokens = new LanTokenService({ LAN_SHARE: true, LAN_SECRET: 'x'.repeat(32) });
    service = new LanService(repo, users, tokens);
  });

  it('publishes and unpublishes a project', async () => {
    expect(await service.isPublished(P)).toBe(false);
    await service.publish(P);
    expect(await service.isPublished(P)).toBe(true);
    expect(await service.listPublished()).toEqual([P]);
    await service.unpublish(P);
    expect(await service.isPublished(P)).toBe(false);
  });

  it('creates an access backed by a lan user, with a one-time pin and no hash exposed', async () => {
    const acc = await service.createAccess(P, '  Ana  ');
    expect(acc.alias).toBe('Ana');
    expect(acc.pin).toMatch(/^\d{4}$/);
    // A real user row backs the access, named after the alias.
    expect(users.rows).toEqual([expect.objectContaining({ issuer: 'lan', name: 'Ana' })]);
    const list = await service.listAccess(P);
    expect(list).toEqual([expect.objectContaining({ id: acc.id, alias: 'Ana' })]);
    expect(JSON.stringify(list)).not.toContain('pinHash');
    expect(JSON.stringify(list)).not.toContain('userId');
  });

  it('grants editor to a lan user only while the project stays published', async () => {
    await service.publish(P);
    await service.createAccess(P, 'Ana');
    const userId = repo.access[0]?.userId ?? '';
    expect(await service.roleOf(P, userId)).toBe('editor');
    expect(await service.roleOf(P, '00000000-0000-4000-8000-0000000000ff')).toBeNull();
    await service.unpublish(P);
    expect(await service.roleOf(P, userId)).toBeNull(); // access kept, but not published
  });

  it('rejects a blank or oversized alias', async () => {
    await expect(service.createAccess(P, '   ')).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.createAccess(P, 'x'.repeat(41))).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('verifies the pin only for a published project', async () => {
    const { pin, id } = await service.createAccess(P, 'Ana');
    expect(await service.verify(P, pin, '10.0.0.5')).toBeNull(); // not published yet
    await service.publish(P);
    expect(await service.verify(P, pin, '10.0.0.5')).toEqual(
      expect.objectContaining({ id, alias: 'Ana', userId: expect.any(String) }),
    );
    expect(await service.verify(P, wrongOf(pin), '10.0.0.5')).toBeNull();
    expect(await service.verify(P, '123', '10.0.0.5')).toBeNull(); // malformed
  });

  it('locks a client out after too many wrong pins, per client', async () => {
    await service.publish(P);
    const { pin } = await service.createAccess(P, 'Ana');
    const bad = wrongOf(pin);
    for (let i = 0; i < 5; i++) expect(await service.verify(P, bad, '10.0.0.9')).toBeNull();
    await expect(service.verify(P, bad, '10.0.0.9')).rejects.toBeInstanceOf(HttpException);
    // the right pin is now locked out too, but only for that client
    await expect(service.verify(P, pin, '10.0.0.9')).rejects.toBeInstanceOf(HttpException);
    expect(await service.verify(P, pin, '10.0.0.10')).toEqual(
      expect.objectContaining({ alias: 'Ana' }),
    );
  });

  it('revokes an access and returns its backing user id', async () => {
    await service.publish(P);
    const { id, pin } = await service.createAccess(P, 'Ana');
    const userId = repo.access[0]?.userId ?? '';
    expect(await service.revokeAccess(P, id)).toBe(userId);
    expect(await service.listAccess(P)).toEqual([]);
    expect(await service.verify(P, pin, '10.0.0.5')).toBeNull();
    expect(await service.revokeAccess(P, id)).toBeNull(); // already gone
  });

  it('keeps the project-wide failure budget across a successful login', async () => {
    await service.publish(P);
    const { pin } = await service.createAccess(P, 'Ana');
    const bad = wrongOf(pin);
    // 29 wrong guesses, at most 4 per client so no single client locks (cap is 5).
    for (let i = 0; i < 29; i++) {
      expect(await service.verify(P, bad, `c${Math.floor(i / 4)}`)).toBeNull();
    }
    // A valid login clears only that client's counter, never the project's — else a friend could
    // reset the budget and walk the PIN space.
    expect(await service.verify(P, pin, 'friend')).toEqual(
      expect.objectContaining({ alias: 'Ana' }),
    );
    expect(await service.verify(P, bad, 'zz')).toBeNull(); // the 30th failure trips the project lock
    await expect(service.verify(P, bad, 'yy')).rejects.toBeInstanceOf(HttpException);
  });

  it('join mints a token for the backing user on a valid pin', async () => {
    await service.publish(P);
    const { pin } = await service.createAccess(P, 'Ana');
    const userId = repo.access[0]?.userId ?? '';
    const joined = await service.join(P, pin, '10.0.0.5');
    expect(joined?.alias).toBe('Ana');
    expect(await tokens.verify(joined?.token ?? '')).toBe(userId);
    expect(await service.join(P, wrongOf(pin), '10.0.0.6')).toBeNull();
  });
});

describe('lanOrigins', () => {
  // biome-ignore lint/suspicious/noExplicitAny: a minimal stub of os.networkInterfaces()
  const nets: any = {
    lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
    eth0: [
      { address: '192.168.0.12', family: 'IPv4', internal: false },
      { address: 'fe80::1', family: 'IPv6', internal: false },
    ],
  };

  it('rebases the app origin onto each non-internal IPv4, dropping loopback and IPv6', () => {
    expect(lanOrigins('http://localhost:5175/', nets)).toEqual(['http://192.168.0.12:5175']);
  });

  it('returns nothing for an unparseable app url', () => {
    expect(lanOrigins('not a url', nets)).toEqual([]);
  });
});
