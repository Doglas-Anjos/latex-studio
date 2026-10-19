import { NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { LOCAL_IDENTITY } from '../../auth/application/identity.service';
import type { DocumentSync } from '../../collab/domain/document-sync';
import { LAN_ISSUER, type User } from '../../users/domain/user';
import { FakeUsers } from '../../users/testing/fake-user.repository';
import { LanService } from '../application/lan.service';
import { LanTokenService } from '../application/lan-token.service';
import { FakeLan } from '../testing/fake-lan.repository';
import { LanRemoteController } from './lan.controller';

const P = '00000000-0000-4000-8000-00000000000a';
const as = (issuer: string) => ({ id: 'u', issuer }) as User;

describe('LanRemoteController', () => {
  const setup = (configured = true) => {
    const repo = new FakeLan();
    const tokens = new LanTokenService(
      configured ? { LAN_SHARE: true, LAN_SECRET: 'x'.repeat(32) } : { LAN_SHARE: false },
    );
    const lan = new LanService(repo, new FakeUsers(), tokens);
    const sync = { revoke: vi.fn() } as unknown as DocumentSync;
    return { repo, lan, sync, controller: new LanRemoteController(lan, sync) };
  };

  it('lets only the local host read or flip it', async () => {
    const { controller } = setup();
    for (const issuer of [LAN_ISSUER, 'https://fasorx.example']) {
      expect(() => controller.status(as(issuer))).toThrow(NotFoundException);
      await expect(controller.setRemote(as(issuer), { on: true })).rejects.toThrow(
        NotFoundException,
      );
    }
    expect(controller.status(as(LOCAL_IDENTITY.issuer))).toEqual({ remote: false }); // off on boot
    await controller.setRemote(as(LOCAL_IDENTITY.issuer), { on: true });
    expect(controller.status(as(LOCAL_IDENTITY.issuer))).toEqual({ remote: true });
  });

  it('is a 404 when LAN share is not configured', () => {
    expect(() => setup(false).controller.status(as(LOCAL_IDENTITY.issuer))).toThrow(
      NotFoundException,
    );
  });

  it('closes every guest socket when switched off', async () => {
    const { repo, lan, sync, controller } = setup();
    const host = as(LOCAL_IDENTITY.issuer);
    await controller.setRemote(host, { on: true });
    await lan.publish(P);
    await lan.createAccess(P, 'Ana');
    await controller.setRemote(host, { on: false });
    expect(sync.revoke).toHaveBeenCalledWith(P, repo.access[0]?.userId);
  });
});
