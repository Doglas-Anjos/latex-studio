import { createToken } from '../di/container';
import type { ApiClient } from './api-client';

export interface User {
  id: string;
  email: string;
  name: string;
  createdAt: string;
  /** Which authenticator vouched for them: 'local', 'lan' (a PIN guest), or the SSO issuer URL. */
  issuer: string;
}

/**
 * `/auth/me`: the user plus whether they govern the platform, and whether only the host may
 * compile/export here (a LAN guest on a Windows host: TeX there could read the host's files).
 */
export type Me = User & { isAdmin: boolean; hostCompiles?: boolean };

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
