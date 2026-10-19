import { createToken } from '../di/container';
import type { ApiClient } from './api-client';

/** A person's LAN access as shown to the host (never the PIN hash). */
export interface LanAccess {
  id: string;
  alias: string;
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
  ): Promise<{ id: string; alias: string; pin: string }>;
  revoke(projectId: string, accessId: string): Promise<void>;
  /** A guest joins with a PIN; the returned token is the LAN session (stored by the caller). */
  join(projectId: string, pin: string): Promise<{ token: string; alias: string }>;
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

  createAccess(projectId: string, alias: string) {
    return this.api.post<{ id: string; alias: string; pin: string }>(
      `/projects/${projectId}/lan/access`,
      { alias },
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
}
