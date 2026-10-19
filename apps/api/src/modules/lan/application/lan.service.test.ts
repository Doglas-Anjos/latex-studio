import { BadRequestException, HttpException } from '@nestjs/common';
import { beforeEach, describe, expect, it } from 'vitest';
import { FakeLan } from '../testing/fake-lan.repository';
import { LanService } from './lan.service';

const P = '00000000-0000-4000-8000-00000000000a';
const wrongOf = (pin: string) => (pin === '0000' ? '0001' : '0000');

describe('LanService', () => {
  let repo: FakeLan;
  let service: LanService;
  beforeEach(() => {
    repo = new FakeLan();
    service = new LanService(repo);
  });

  it('publishes and unpublishes a project', async () => {
    expect(await service.isPublished(P)).toBe(false);
    await service.publish(P);
    expect(await service.isPublished(P)).toBe(true);
    expect(await service.listPublished()).toEqual([P]);
    await service.unpublish(P);
    expect(await service.isPublished(P)).toBe(false);
  });

  it('creates an access with a one-time pin and never exposes the hash', async () => {
    const acc = await service.createAccess(P, '  Ana  ');
    expect(acc.alias).toBe('Ana');
    expect(acc.pin).toMatch(/^\d{4}$/);
    const list = await service.listAccess(P);
    expect(list).toEqual([expect.objectContaining({ id: acc.id, alias: 'Ana' })]);
    expect(JSON.stringify(list)).not.toContain('pinHash');
    expect(JSON.stringify(list)).not.toContain(acc.pin);
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
    expect(await service.verify(P, pin, '10.0.0.5')).toEqual({ id, alias: 'Ana' });
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

  it('revokes an access', async () => {
    await service.publish(P);
    const { id, pin } = await service.createAccess(P, 'Ana');
    await service.revokeAccess(id);
    expect(await service.listAccess(P)).toEqual([]);
    expect(await service.verify(P, pin, '10.0.0.5')).toBeNull();
  });
});
