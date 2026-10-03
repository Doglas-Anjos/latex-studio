import type { Identity } from '../../users/domain/user';

export const TOKEN_VERIFIER = Symbol('TOKEN_VERIFIER');

export interface VerifiedToken {
  identity: Identity;
  /** Unix seconds; the caller caches the user until then. */
  expiresAt: number;
}

/** Checks the signed assertion from the application in front. Null for anything invalid. */
export interface TokenVerifier {
  verify(token: string): Promise<VerifiedToken | null>;
}
