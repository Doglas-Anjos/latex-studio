import type { Identity, User } from './user';

export const USER_REPOSITORY = Symbol('USER_REPOSITORY');

export interface UserRepository {
  findByEmail(email: string): Promise<User | null>;
  findById(id: string): Promise<User | null>;
  /** The user behind issuer + subject, created on first sight; email and name are refreshed. */
  upsert(identity: Identity): Promise<User>;
}
