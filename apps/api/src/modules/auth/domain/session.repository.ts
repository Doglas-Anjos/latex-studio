export const SESSION_REPOSITORY = Symbol('SESSION_REPOSITORY');

export interface Session {
  /** sha256 of the cookie token, hex. */
  tokenHash: string;
  userId: string;
  expiresAt: Date;
}

export interface SessionRepository {
  create(session: Session): Promise<void>;
  findByTokenHash(tokenHash: string): Promise<Session | null>;
  deleteByTokenHash(tokenHash: string): Promise<void>;
  deleteExpired(): Promise<void>;
}
