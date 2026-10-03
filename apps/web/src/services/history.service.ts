import { createToken } from '../di/container';
import type { ApiClient } from './api-client';

export interface HistoryEntry {
  sha: string;
  message: string;
  author: { name: string; email: string };
  date: string;
}

export interface FileChange {
  path: string;
  type: 'add' | 'modify' | 'remove';
}

export interface HistoryService {
  log(projectId: string, limit?: number): Promise<HistoryEntry[]>;
  changes(projectId: string, from: string, to: string): Promise<FileChange[]>;
  /** File content at a commit, as text. */
  file(projectId: string, sha: string, path: string): Promise<string>;
  commit(projectId: string, message: string): Promise<{ sha: string }>;
  restore(projectId: string, sha: string, path: string): Promise<{ sha: string }>;
}

export const HistoryServiceToken = createToken<HistoryService>('HistoryService');

export class HttpHistoryService implements HistoryService {
  constructor(private readonly api: ApiClient) {}

  log(projectId: string, limit = 50) {
    return this.api.get<HistoryEntry[]>(`/projects/${projectId}/history?limit=${limit}`);
  }

  changes(projectId: string, from: string, to: string) {
    const q = new URLSearchParams({ from, to });
    return this.api.get<FileChange[]>(`/projects/${projectId}/history/changes?${q}`);
  }

  async file(projectId: string, sha: string, path: string) {
    const q = new URLSearchParams({ sha, path });
    const res = await this.api.getRaw(`/projects/${projectId}/history/file?${q}`);
    return res.text();
  }

  commit(projectId: string, message: string) {
    return this.api.post<{ sha: string }>(`/projects/${projectId}/history/commit`, { message });
  }

  restore(projectId: string, sha: string, path: string) {
    return this.api.post<{ sha: string }>(`/projects/${projectId}/history/restore`, { sha, path });
  }
}
