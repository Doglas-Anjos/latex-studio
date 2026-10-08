import { createToken } from '../di/container';
import type { ApiClient } from './api-client';

export interface User {
  id: string;
  email: string;
  name: string;
  createdAt: string;
}

/** `/auth/me`: the user plus whether they govern the platform. */
export type Me = User & { isAdmin: boolean };

export interface AuthService {
  me(): Promise<Me>;
}

export const AuthServiceToken = createToken<AuthService>('AuthService');

export class HttpAuthService implements AuthService {
  constructor(private readonly api: ApiClient) {}

  me() {
    return this.api.get<Me>('/auth/me');
  }
}
