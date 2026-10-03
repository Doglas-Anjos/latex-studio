import { createToken } from '../di/container';
import type { ApiClient } from './api-client';

export interface User {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'user';
  status: 'pending' | 'active' | 'blocked';
  createdAt: string;
}

export type Credentials = { email: string; password: string };
export type RegisterInput = Credentials & { name: string };

export interface AuthService {
  register(input: RegisterInput): Promise<void>;
  login(input: Credentials): Promise<User>;
  logout(): Promise<void>;
  me(): Promise<User>;
}

export const AuthServiceToken = createToken<AuthService>('AuthService');

export class HttpAuthService implements AuthService {
  constructor(private readonly api: ApiClient) {}

  async register(input: RegisterInput) {
    await this.api.post('/auth/register', input);
  }

  login(input: Credentials) {
    return this.api.post<User>('/auth/login', input);
  }

  async logout() {
    await this.api.post('/auth/logout');
  }

  me() {
    return this.api.get<User>('/auth/me');
  }
}
