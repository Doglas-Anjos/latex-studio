import { Inject, Injectable, Optional } from '@nestjs/common';
import type { User } from '../../users/domain/user';
import { USER_REPOSITORY, type UserRepository } from '../../users/domain/user.repository';
import { TOKEN_VERIFIER, type TokenVerifier } from '../domain/token-verifier';

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;

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
  ) {}

  /**
   * The user behind `Authorization: Bearer <token>`, or null when the token is missing or bad.
   * In local mode the request must also be addressed to localhost (`host`): the config gate only
   * sees APP_URL, and a page on another site could otherwise reach the API by DNS rebinding.
   */
  async resolve(token: string | null, host: string | undefined): Promise<User | null> {
    if (!this.verifier) {
      if (!LOCAL_HOST.test(host ?? '')) return null;
      this.local ??= this.users.upsert(LOCAL_IDENTITY).catch((e) => {
        this.local = undefined;
        throw e;
      });
      return this.local;
    }
    if (!token) return null;
    const now = Date.now() / 1000;
    const hit = this.cache.get(token);
    if (hit && hit.expiresAt > now) return hit.user;
    const verified = await this.verifier.verify(token);
    if (!verified) return null;
    const user = await this.users.upsert(verified.identity);
    if (this.cache.size >= 1000) this.cache.clear();
    this.cache.set(token, { user, expiresAt: verified.expiresAt });
    return user;
  }
}

/** The token from an `Authorization` header, or null. */
export function bearerToken(header: string | undefined): string | null {
  const [scheme, token] = header?.split(' ', 2) ?? [];
  return scheme?.toLowerCase() === 'bearer' && token?.trim() ? token.trim() : null;
}
