import { createToken } from '../di/container';
import type { ApiClient } from './api-client';
import type { AssignableRole } from './member.service';

/** A person's LAN access as shown to the host (never the PIN hash). */
export interface LanAccess {
  id: string;
  alias: string;
  role: AssignableRole;
  createdAt: string;
  lastSeen: string | null;
}

export interface LanStatus {
  /** Whether the server has LAN share configured at all (flag + secret). */
  enabled: boolean;
  published: boolean;
  access: LanAccess[];
  /** Origins the host is reachable at on the LAN, for building a shareable link. */
  urls: string[];
}

export interface LanService {
  status(projectId: string): Promise<LanStatus>;
  publish(projectId: string): Promise<void>;
  unpublish(projectId: string): Promise<void>;
  /** Creates a guest and returns the one-time plaintext PIN to hand them. */
  createAccess(
    projectId: string,
    alias: string,
    role: AssignableRole,
  ): Promise<{ id: string; alias: string; role: AssignableRole; pin: string }>;
  revoke(projectId: string, accessId: string): Promise<void>;
  /** A guest joins with a PIN; the returned token is the LAN session (stored by the caller). */
  join(projectId: string, pin: string): Promise<{ token: string; alias: string }>;
  /** The remote-access switch; a 404 (not the local host, or LAN share off) means "no switch". */
  remote(): Promise<{ remote: boolean }>;
  setRemote(on: boolean): Promise<void>;
}

export const LanServiceToken = createToken<LanService>('LanService');

export class HttpLanService implements LanService {
  constructor(private readonly api: ApiClient) {}

  status(projectId: string) {
    return this.api.get<LanStatus>(`/projects/${projectId}/lan`);
  }

  async publish(projectId: string) {
    await this.api.post(`/projects/${projectId}/lan/publish`);
  }

  async unpublish(projectId: string) {
    await this.api.post(`/projects/${projectId}/lan/unpublish`);
  }

  createAccess(projectId: string, alias: string, role: AssignableRole) {
    return this.api.post<{ id: string; alias: string; role: AssignableRole; pin: string }>(
      `/projects/${projectId}/lan/access`,
      { alias, role },
    );
  }

  async revoke(projectId: string, accessId: string) {
    await this.api.delete(`/projects/${projectId}/lan/access/${accessId}`);
  }

  join(projectId: string, pin: string) {
    return this.api.post<{ token: string; alias: string }>(`/projects/${projectId}/lan/join`, {
      pin,
    });
  }

  remote() {
    return this.api.get<{ remote: boolean }>('/lan');
  }

  async setRemote(on: boolean) {
    await this.api.post('/lan/remote', { on });
  }
}
