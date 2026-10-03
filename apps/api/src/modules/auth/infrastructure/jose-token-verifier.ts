import type { AppConfig } from '@latex-studio/core';
import { Logger, ServiceUnavailableException } from '@nestjs/common';
import {
  createRemoteJWKSet,
  errors,
  type JWTPayload,
  type JWTVerifyOptions,
  jwtVerify,
} from 'jose';
import type { TokenVerifier, VerifiedToken } from '../domain/token-verifier';

/** Clocks on the two machines never agree exactly; 30 s covers normal NTP drift. */
const CLOCK_TOLERANCE_S = 30;

export type VerifierConfig = Pick<
  AppConfig,
  'AUTH_JWKS_URL' | 'AUTH_SECRET' | 'AUTH_ISSUER' | 'AUTH_AUDIENCE' | 'AUTH_MAX_TOKEN_TTL_S'
>;

/**
 * RS256 against the issuer's JWKS, or HS256 with a shared secret. The algorithm is ours, never
 * the token header's: accepting the header's choice is the classic defect of this family.
 * Refusals are logged by type but answered uniformly: "why" only helps whoever is guessing.
 */
export class JoseTokenVerifier implements TokenVerifier {
  private readonly logger = new Logger(JoseTokenVerifier.name);
  private readonly decode: (token: string) => Promise<{ payload: JWTPayload }>;

  constructor(private readonly config: VerifierConfig) {
    if (!config.AUTH_ISSUER || !config.AUTH_AUDIENCE) {
      throw new Error('JoseTokenVerifier needs AUTH_ISSUER and AUTH_AUDIENCE');
    }
    const options: JWTVerifyOptions = {
      issuer: config.AUTH_ISSUER,
      audience: config.AUTH_AUDIENCE,
      clockTolerance: CLOCK_TOLERANCE_S,
      requiredClaims: ['exp', 'iss', 'aud', 'sub', 'email', 'name'],
    };
    if (config.AUTH_JWKS_URL) {
      // The remote set caches keys and refetches only on an unknown `kid` (rotation).
      const jwks = createRemoteJWKSet(new URL(config.AUTH_JWKS_URL), { timeoutDuration: 10_000 });
      const opts = { ...options, algorithms: ['RS256'] };
      this.decode = (token) => jwtVerify(token, jwks, opts);
    } else if (config.AUTH_SECRET) {
      const secret = new TextEncoder().encode(config.AUTH_SECRET);
      const opts = { ...options, algorithms: ['HS256'] };
      this.decode = (token) => jwtVerify(token, secret, opts);
    } else {
      throw new Error('JoseTokenVerifier needs AUTH_JWKS_URL or AUTH_SECRET');
    }
  }

  async verify(token: string): Promise<VerifiedToken | null> {
    let payload: JWTPayload;
    try {
      ({ payload } = await this.decode(token));
    } catch (error) {
      // Only a token defect is a 401. A JWKS outage is ours: a 401 would bounce the person to
      // FasorX and back in a loop.
      if (error instanceof errors.JWKSTimeout || !(error instanceof errors.JOSEError)) {
        this.logger.error(`cannot verify tokens: ${(error as Error).name}`);
        throw new ServiceUnavailableException('Identity provider unreachable');
      }
      this.logger.warn(`token refused: ${(error as Error).name}`);
      return null;
    }
    // A leaked token is valid until it expires and cannot be revoked: the window must be ours.
    const exp = payload.exp as number;
    if (exp - Date.now() / 1000 > this.config.AUTH_MAX_TOKEN_TTL_S + CLOCK_TOLERANCE_S) {
      this.logger.warn(`token refused: lifetime above ${this.config.AUTH_MAX_TOKEN_TTL_S}s`);
      return null;
    }
    const { sub, email, name } = payload;
    if (typeof email !== 'string' || typeof name !== 'string' || typeof sub !== 'string') {
      return null;
    }
    // These go straight into the database and the UI: bounded, no control characters.
    const clean = (s: string, max: number) =>
      s
        .replace(/\p{Cc}/gu, '')
        .trim()
        .slice(0, max);
    const identity = {
      issuer: String(this.config.AUTH_ISSUER).replace(/\/$/, ''),
      subject: clean(sub, 200),
      email: clean(email, 254).toLowerCase(),
      name: clean(name, 100),
    };
    if (!identity.subject || !identity.email.includes('@')) return null;
    return { identity: { ...identity, name: identity.name || identity.email }, expiresAt: exp };
  }
}
