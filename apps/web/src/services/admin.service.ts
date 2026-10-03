import { createToken } from '../di/container';
import type { ApiClient } from './api-client';
import type { User } from './auth.service';

export interface AdminService {
  listUsers(status: User['status']): Promise<User[]>;
  updateUser(id: string, patch: { status?: User['status']; role?: User['role'] }): Promise<User>;
}

export const AdminServiceToken = createToken<AdminService>('AdminService');

export class HttpAdminService implements AdminService {
  constructor(private readonly api: ApiClient) {}

  listUsers(status: User['status']) {
    return this.api.get<User[]>(`/admin/users?status=${status}`);
  }

  updateUser(id: string, patch: { status?: User['status']; role?: User['role'] }) {
    return this.api.patch<User>(`/admin/users/${encodeURIComponent(id)}`, patch);
  }
}
