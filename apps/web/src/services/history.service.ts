import { createToken } from '../di/container';
import type { ApiClient } from './api-client';

export interface HistoryEntry {
  sha: string;
  message: string;
  author: { name: string };
  date: string;
}

/**
 * A commit message's first line, and the names in its `Co-authored-by` trailers (the API already
 * drops their e-mails): lists show the subject, not the trailers glued to it.
 */
export function splitCommitMessage(message: string): { subject: string; coAuthors: string[] } {
  const [subject = '', ...rest] = message.split('\n');
  const coAuthors = rest.flatMap((line) => {
    const name = /^co-authored-by:\s*(.*?)\s*(?:<[^<>]*>)?\s*$/i.exec(line)?.[1];
    return name ? [name] : [];
  });
  return { subject, coAuthors };
}

export interface FileChange {
  path: string;
  type: 'add' | 'modify' | 'remove';
}

/** A working-tree change tagged with who edited it collaboratively since the baseline. */
export interface StatusChange extends FileChange {
  /** The caller touched this file. */
  mine: boolean;
  /** Names of the other people who edited it (e-mails dropped by the API). */
  others: string[];
}

export interface HistoryStatus {
  baseline: { sha: string; message: string; date: string } | null;
  changes: StatusChange[];
}

export interface BlameRun {
  from: number;
  to: number;
  sha: string | null;
}

export interface Blame {
  commits: Record<string, { author: { name: string }; date: string; message: string }>;
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
  /** `paths` limits the version to those files; all changes when omitted. */
  commit(projectId: string, message: string, paths?: string[]): Promise<{ sha: string }>;
  /** Commits only `path` ("Ctrl+S"); an empty message falls back to a default on the server. */
  commitFile(projectId: string, path: string, message?: string): Promise<{ sha: string }>;
  /** `sha` is null when nothing needed committing (discarding uncommitted edits). */
  restore(projectId: string, sha: string, path: string): Promise<{ sha: string | null }>;
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

  commit(projectId: string, message: string, paths?: string[]) {
    return this.api.post<{ sha: string }>(`/projects/${projectId}/history/commit`, {
      message,
      ...(paths && { paths }),
    });
  }

  commitFile(projectId: string, path: string, message?: string) {
    return this.api.post<{ sha: string }>(`/projects/${projectId}/history/commit-file`, {
      path,
      message,
    });
  }

  restore(projectId: string, sha: string, path: string) {
    return this.api.post<{ sha: string | null }>(`/projects/${projectId}/history/restore`, {
      sha,
      path,
    });
  }
}
