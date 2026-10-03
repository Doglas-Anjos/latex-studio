import type { User, UserCredentials, UserRole, UserStatus } from './user';

export const USER_REPOSITORY = Symbol('USER_REPOSITORY');

export interface NewUser {
  email: string;
  name: string;
  passwordHash: string;
  role?: UserRole;
  status?: UserStatus;
}

export interface UserRepository {
  findByEmail(email: string): Promise<UserCredentials | null>;
  findById(id: string): Promise<User | null>;
  /** Returns null when the email is already taken. */
  create(user: NewUser): Promise<User | null>;
  countAdmins(): Promise<number>;
}
