import { describe, expect, it } from 'vitest';
import { LanTokenService } from './lan-token.service';

const SECRET = 'x'.repeat(32);
const on = () => new LanTokenService({ LAN_SHARE: true, LAN_SECRET: SECRET });

describe('LanTokenService', () => {
  it('signs a token that verifies back to the user id', async () => {
    const svc = on();
    expect(svc.enabled).toBe(true);
    const token = await svc.sign('user-1');
    expect(typeof token).toBe('string');
    expect(await svc.verify(token as string)).toBe('user-1');
  });

  it('rejects a token signed with another secret, and garbage', async () => {
    const other = new LanTokenService({ LAN_SHARE: true, LAN_SECRET: 'y'.repeat(32) });
    const foreign = (await other.sign('user-1')) as string;
    expect(await on().verify(foreign)).toBeNull();
    expect(await on().verify('not.a.jwt')).toBeNull();
  });

  it('is off (sign/verify null) without LAN share configured', async () => {
    const off = new LanTokenService({ LAN_SHARE: false, LAN_SECRET: SECRET });
    expect(off.enabled).toBe(false);
    expect(await off.sign('user-1')).toBeNull();
    expect(await off.verify('whatever')).toBeNull();
    // Flag on but no secret: still off.
    expect(new LanTokenService({ LAN_SHARE: true }).enabled).toBe(false);
  });
});
