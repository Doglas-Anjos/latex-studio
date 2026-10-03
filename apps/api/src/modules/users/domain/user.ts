export type UserRole = 'admin' | 'user';
export type UserStatus = 'pending' | 'active' | 'blocked';

/** Public view of a user: safe to return from the API. */
export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  status: UserStatus;
  createdAt: Date;
}

/** Only the auth use cases need the hash. */
export interface UserCredentials extends User {
  passwordHash: string;
}
