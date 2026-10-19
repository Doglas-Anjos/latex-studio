import { Inject, Injectable, Optional } from '@nestjs/common';
import { LanTokenService } from '../../lan/application/lan-token.service';
import { LAN_ISSUER, type User } from '../../users/domain/user';
import { USER_REPOSITORY, type UserRepository } from '../../users/domain/user.repository';
import { TOKEN_VERIFIER, type TokenVerifier } from '../domain/token-verifier';

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;
const LOOPBACK_IP = /^(?:127\.\d+\.\d+\.\d+|::1|::ffff:127\.\d+\.\d+\.\d+)$/;

/** True only for a loopback peer address (unspoofable, unlike the Host header). */
export function isLoopback(ip: string | undefined): boolean {
  return !!ip && LOOPBACK_IP.test(ip);
}

/**
 * The real client address of a raw request (the WebSocket upgrade, where Fastify's request.ip is not
 * available). When the socket is a loopback proxy (Vite in dev, Caddy in production), only the
 * right-most X-Forwarded-For entry is the proxy's own record of the client; everything to its left
 * was sent by the client and is forgeable. Any other socket is the client itself.
 */
export function peerIp(forwardedFor: string | undefined, socketIp: string): string {
  if (!forwardedFor || !isLoopback(socketIp)) return socketIp;
  return forwardedFor.split(',').at(-1)?.trim() || socketIp;
}

/** Who every request is in local mode (no verifier configured; config allows that only on localhost). */
export const LOCAL_IDENTITY = {
  issuer: 'local',
  subject: 'owner',
  email: 'local@localhost',
  name: 'Local',
};

/**
 * Resolves the bearer token of a request to a user. The authenticator in front signs who is
 * logged in; this service verifies the signature and finds or creates the matching account.
 */
@Injectable()
export class IdentityService {
  // ponytail: cache keyed by the exact token string, dropped at its exp; tokens live minutes
  // and there is one per open tab, so a Map is plenty. Capped so a flood cannot grow it.
  private readonly cache = new Map<string, { user: User; expiresAt: number }>();
  private local?: Promise<User> | undefined;

  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Optional() @Inject(TOKEN_VERIFIER) private readonly verifier?: TokenVerifier,
    @Optional() @Inject(LanTokenService) private readonly lanTokens?: LanTokenService,
  ) {}

  /**
   * The user behind `Authorization: Bearer <token>`, or null when the token is missing or bad.
   * In local mode the request must be addressed to localhost (`host`, against DNS rebinding) AND
   * arrive from a loopback peer (`remoteIp`): with LAN share the API binds the LAN interface, and a
   * peer there could otherwise spoof `Host: localhost` over a raw socket to be granted the owner.
   * `remoteIp` is the real client even through the dev Vite proxy: Vite appends it to
   * X-Forwarded-For (`xfwd`), Fastify reads that header only from a loopback socket (trustProxy
   * 'loopback') and the WebSocket upgrade takes only its right-most entry (`peerIp`).
   * ponytail: that trusts whatever listens on loopback to append the client. A loopback proxy that
   * does not (Vite without `xfwd`, another local reverse proxy) makes every client look like
   * loopback, leaving the Host header, which a non-browser client can forge, as the only gate. Fine
   * for this trusted-network feature; a hardened topology serves the app from the API itself.
   */
  async resolve(
    token: string | null,
    host: string | undefined,
    remoteIp: string,
  ): Promise<User | null> {
    // A LAN peer presents a LAN session token (minted after a PIN), checked before the local-mode
    // fallback so a peer on the LAN IP is never auto-granted the host. Only a LAN user row counts:
    // even a forged token (leaked LAN_SECRET) cannot name the host's own account.
    if (token && this.lanTokens?.enabled) {
      const userId = await this.lanTokens.verify(token);
      if (userId) {
        const user = await this.users.findById(userId);
        return user?.issuer === LAN_ISSUER ? user : null;
      }
    }
    if (!this.verifier) {
      if (!LOCAL_HOST.test(host ?? '') || !isLoopback(remoteIp)) return null;
      this.local ??= this.users.upsert(LOCAL_IDENTITY).catch((e) => {
        this.local = undefined;
        throw e;
      });
      return this.local;
    }
    if (!token) return null;
    const cached = this.cachedUser(token);
    if (cached) return cached;
    const verified = await this.verifier.verify(token);
    if (!verified) return null;
    const user = await this.users.upsert(verified.identity);
    if (this.cache.size >= 1000) this.cache.clear();
    this.cache.set(token, { user, expiresAt: verified.expiresAt });
    return user;
  }

  /** The user `token` was already verified as (still valid), without verifying it again. */
  cachedUser(token: string | null): User | null {
    const hit = token ? this.cache.get(token) : undefined;
    return hit && hit.expiresAt > Date.now() / 1000 ? hit.user : null;
  }
}

/** The token from an `Authorization` header, or null. */
export function bearerToken(header: string | undefined): string | null {
  const [scheme, token] = header?.split(' ', 2) ?? [];
  return scheme?.toLowerCase() === 'bearer' && token?.trim() ? token.trim() : null;
}

/**
 * Rate-limit bucket: the verified user, else the client IP (on IPv6 its /64, which one client
 * usually owns). Per person because a campus NAT puts a whole university behind one address;
 * never an unverified `sub`, which anyone could forge to dodge a limit or spend someone else's.
 * Only reads the cache the guard fills: a token's first request counts against the IP, and a
 * flood of forged tokens costs no signature check once the IP is over its limit.
 */
export function rateLimitKey(
  identity: Pick<IdentityService, 'cachedUser'>,
  request: { headers: { authorization?: string | undefined }; ip: string },
): string {
  const user = identity.cachedUser(bearerToken(request.headers.authorization));
  return user ? `user:${user.id}` : ipBucket(request.ip);
}

/** IPv4 as is; IPv6 by its /64 (`::` expanded first). */
function ipBucket(ip: string): string {
  if (!ip.includes(':') || ip.includes('.')) return ip; // IPv4, or IPv4-mapped IPv6
  const [head = '', tail] = ip.split('::');
  const h = head ? head.split(':') : [];
  const t = tail ? tail.split(':') : [];
  return [...h, ...Array(8 - h.length - t.length).fill('0'), ...t].slice(0, 4).join(':');
}
