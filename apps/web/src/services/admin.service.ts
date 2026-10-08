import { createToken } from '../di/container';
import type { ApiClient } from './api-client';
import type { User } from './auth.service';
import type { Project } from './project.service';

export interface AdminUserPage {
  items: User[];
  total: number;
}

export interface AdminService {
  listUsers(opts: { search?: string; page?: number; limit?: number }): Promise<AdminUserPage>;
  userProjects(userId: string): Promise<{ items: Project[] }>;
  deleteProject(projectId: string): Promise<void>;
}

export const AdminServiceToken = createToken<AdminService>('AdminService');

export class HttpAdminService implements AdminService {
  constructor(private readonly api: ApiClient) {}

  listUsers({ search, page = 0, limit = 25 }: { search?: string; page?: number; limit?: number }) {
    const q = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (search) q.set('search', search);
    return this.api.get<AdminUserPage>(`/admin/users?${q}`);
  }

  userProjects(userId: string) {
    return this.api.get<{ items: Project[] }>(`/admin/users/${userId}/projects`);
  }

  async deleteProject(projectId: string) {
    await this.api.delete(`/admin/projects/${projectId}`);
  }
}
