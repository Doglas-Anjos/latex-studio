import { describe, expect, it } from 'vitest';
import { LanTokenService } from './lan-token.service';

const SECRET = 'x'.repeat(32);
const on = (secret = SECRET) => {
  const svc = new LanTokenService({ LAN_SHARE: true, LAN_SECRET: secret });
  svc.setRemote(true);
  return svc;
};

describe('LanTokenService', () => {
  it('boots with remote access off, and a switch-off suspends tokens already handed out', async () => {
    const svc = new LanTokenService({ LAN_SHARE: true, LAN_SECRET: SECRET });
    expect(svc.configured).toBe(true);
    expect(svc.enabled).toBe(false);
    expect(await svc.sign('user-1')).toBeNull();
    svc.setRemote(true);
    const token = (await svc.sign('user-1')) as string;
    svc.setRemote(false);
    expect(await svc.verify(token)).toBeNull();
    svc.setRemote(true);
    expect(await svc.verify(token)).toBe('user-1'); // back on: suspended, not revoked
  });

  it('signs a token that verifies back to the user id', async () => {
    const svc = on();
    expect(svc.enabled).toBe(true);
    const token = await svc.sign('user-1');
    expect(typeof token).toBe('string');
    expect(await svc.verify(token as string)).toBe('user-1');
  });

  it('rejects a token signed with another secret, and garbage', async () => {
    const foreign = (await on('y'.repeat(32)).sign('user-1')) as string;
    expect(await on().verify(foreign)).toBeNull();
    expect(await on().verify('not.a.jwt')).toBeNull();
  });

  it('is off (sign/verify null) without LAN share configured', async () => {
    const off = new LanTokenService({ LAN_SHARE: false, LAN_SECRET: SECRET });
    off.setRemote(true);
    expect(off.configured).toBe(false);
    expect(off.enabled).toBe(false);
    expect(await off.sign('user-1')).toBeNull();
    expect(await off.verify('whatever')).toBeNull();
    // Flag on but no secret: still off.
    expect(new LanTokenService({ LAN_SHARE: true }).configured).toBe(false);
  });
});
