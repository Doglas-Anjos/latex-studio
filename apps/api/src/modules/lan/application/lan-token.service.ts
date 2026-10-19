import { APP_CONFIG, type AppConfig } from '@latex-studio/core';
import { Inject, Injectable } from '@nestjs/common';
import { jwtVerify, SignJWT } from 'jose';

const ISSUER = 'lan';
const AUDIENCE = 'lan';
const ALG = 'HS256';
const CLOCK_TOLERANCE_S = 30;
// A LAN session lasts an editing session; the friend re-enters the PIN after it. Deleting the access
// or unpublishing ends it for good (the role check denies the next request); switching remote access
// off only suspends it: tokens count again, without a PIN, once it is back on within their 12h.
const TTL_S = 12 * 60 * 60;

/**
 * Signs and verifies the short session token a LAN peer receives after entering a valid PIN. HS256
 * with LAN_SECRET; off (sign/verify return null) unless LAN share is configured and the host has
 * switched remote access on. The algorithm is ours, never the token header's.
 */
@Injectable()
export class LanTokenService {
  private readonly secret?: Uint8Array;
  // ponytail: in memory, so off on every boot by design: a running server never lets a guest in
  // until the host flips it on. Persist it if hosts want it to survive restarts.
  private remote = false;

  constructor(@Inject(APP_CONFIG) config: Pick<AppConfig, 'LAN_SHARE' | 'LAN_SECRET'>) {
    if (config.LAN_SHARE && config.LAN_SECRET) {
      this.secret = new TextEncoder().encode(config.LAN_SECRET);
    }
  }

  /** LAN share is configured (flag on and a secret present): the host can publish, mint PINs. */
  get configured(): boolean {
    return this.secret !== undefined;
  }

  /** Configured and remote access switched on: only then do guests join and their tokens count. */
  get enabled(): boolean {
    return this.configured && this.remote;
  }

  setRemote(on: boolean): void {
    this.remote = on;
  }

  /** A token for the access's backing user id, or null when LAN share or remote access is off. */
  async sign(userId: string): Promise<string | null> {
    if (!this.remote || !this.secret) return null;
    return new SignJWT({})
      .setProtectedHeader({ alg: ALG })
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setSubject(userId)
      .setIssuedAt()
      .setExpirationTime(`${TTL_S}s`)
      .sign(this.secret);
  }

  /** The user id a valid LAN token is for, or null (bad signature, expired, wrong issuer, off). */
  async verify(token: string): Promise<string | null> {
    if (!this.remote || !this.secret) return null;
    try {
      const { payload } = await jwtVerify(token, this.secret, {
        issuer: ISSUER,
        audience: AUDIENCE,
        algorithms: [ALG],
        clockTolerance: CLOCK_TOLERANCE_S,
        requiredClaims: ['exp', 'iss', 'aud', 'sub'],
      });
      return typeof payload.sub === 'string' && payload.sub ? payload.sub : null;
    } catch {
      return null;
    }
  }
}
