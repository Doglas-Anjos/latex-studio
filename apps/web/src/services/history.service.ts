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

export interface HistoryStatus {
  baseline: { sha: string; message: string; date: string } | null;
  changes: FileChange[];
}

export interface BlameRun {
  from: number;
  to: number;
  sha: string | null;
}

export interface Blame {
  commits: Record<
    string,
    { author: { name: string; email: string }; date: string; message: string }
  >;
  lines: BlameRun[];
}

export interface HistoryService {
  log(projectId: string, limit?: number): Promise<HistoryEntry[]>;
  /** Commits that touched `path`, newest first. */
  fileLog(projectId: string, path: string, limit?: number): Promise<HistoryEntry[]>;
  changes(projectId: string, from: string, to: string): Promise<FileChange[]>;
  /** File content at a commit, as text. */
  file(projectId: string, sha: string, path: string): Promise<string>;
  status(projectId: string): Promise<HistoryStatus>;
  blame(projectId: string, path: string): Promise<Blame>;
  commit(projectId: string, message: string): Promise<{ sha: string }>;
  /** Commits only `path` ("Ctrl+S"); an empty message falls back to a default on the server. */
  commitFile(projectId: string, path: string, message?: string): Promise<{ sha: string }>;
  restore(projectId: string, sha: string, path: string): Promise<{ sha: string }>;
}

export const HistoryServiceToken = createToken<HistoryService>('HistoryService');

export class HttpHistoryService implements HistoryService {
  constructor(private readonly api: ApiClient) {}

  log(projectId: string, limit = 50) {
    return this.api.get<HistoryEntry[]>(`/projects/${projectId}/history?limit=${limit}`);
  }

  fileLog(projectId: string, path: string, limit = 50) {
    const q = new URLSearchParams({ path, limit: String(limit) });
    return this.api.get<HistoryEntry[]>(`/projects/${projectId}/history/file-log?${q}`);
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

  status(projectId: string) {
    return this.api.get<HistoryStatus>(`/projects/${projectId}/history/status`);
  }

  blame(projectId: string, path: string) {
    return this.api.get<Blame>(
      `/projects/${projectId}/history/blame?path=${encodeURIComponent(path)}`,
    );
  }

  commit(projectId: string, message: string) {
    return this.api.post<{ sha: string }>(`/projects/${projectId}/history/commit`, { message });
  }

  commitFile(projectId: string, path: string, message?: string) {
    return this.api.post<{ sha: string }>(`/projects/${projectId}/history/commit-file`, {
      path,
      message,
    });
  }

  restore(projectId: string, sha: string, path: string) {
    return this.api.post<{ sha: string }>(`/projects/${projectId}/history/restore`, { sha, path });
  }
}
