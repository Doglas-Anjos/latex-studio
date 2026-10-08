import { createToken } from '../di/container';
import type { ApiClient } from './api-client';
import type { Role } from './project.service';

export interface Member {
  userId: string;
  name: string;
  /** Only sent to the project owner. */
  email?: string;
  role: Role;
}

export type AssignableRole = Exclude<Role, 'owner'>;

export interface MemberService {
  list(projectId: string): Promise<Member[]>;
  invite(projectId: string, email: string, role: AssignableRole): Promise<Member[]>;
  setRole(projectId: string, userId: string, role: AssignableRole): Promise<Member[]>;
  remove(projectId: string, userId: string): Promise<void>;
}

export const MemberServiceToken = createToken<MemberService>('MemberService');

export class HttpMemberService implements MemberService {
  constructor(private readonly api: ApiClient) {}

  list(projectId: string) {
    return this.api.get<Member[]>(`/projects/${projectId}/members`);
  }

  invite(projectId: string, email: string, role: AssignableRole) {
    return this.api.post<Member[]>(`/projects/${projectId}/members`, { email, role });
  }

  setRole(projectId: string, userId: string, role: AssignableRole) {
    return this.api.patch<Member[]>(`/projects/${projectId}/members/${userId}`, { role });
  }

  remove(projectId: string, userId: string) {
    return this.api.delete(`/projects/${projectId}/members/${userId}`);
  }
}
