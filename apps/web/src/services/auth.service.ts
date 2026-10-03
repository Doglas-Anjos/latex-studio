import { createToken } from '../di/container';
import type { ApiClient } from './api-client';

export interface User {
  id: string;
  email: string;
  name: string;
  createdAt: string;
}

export interface AuthService {
  me(): Promise<User>;
}

export const AuthServiceToken = createToken<AuthService>('AuthService');

export class HttpAuthService implements AuthService {
  constructor(private readonly api: ApiClient) {}

  me() {
    return this.api.get<User>('/auth/me');
  }
}
