import { createToken } from '../di/container';
import type { ApiClient } from './api-client';

export interface LogEntry {
  file?: string;
  line?: number;
  message: string;
}

export type BuildStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'timeout' | 'cancelled';
export type CompileOptions = { draft?: boolean; haltOnError?: boolean };

export interface Build {
  id: string;
  projectId: string;
  status: BuildStatus;
  engine: string;
  mainFile: string;
  commitSha: string | null;
  exitCode: number | null;
  errors: LogEntry[];
  warnings: LogEntry[];
  info?: LogEntry[];
  options?: CompileOptions;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export const isActive = (b?: Build) => b?.status === 'queued' || b?.status === 'running';

/**
 * A queued/running build older than this looks stuck (orphaned job or crashed worker). Kept in
 * the same ballpark as the API's COMPILE_TIMEOUT_MS + buffer (compile.service.ts), but doesn't
 * need to match exactly: this only decides when to offer retrying, and the API re-validates and
 * fails the stale build for real before accepting a new one.
 */
export const STALE_BUILD_MS = 5 * 60_000;

export const isStale = (b?: Build) => {
  if (!isActive(b) || !b) return false;
  const since = b.startedAt ?? b.createdAt;
  return Date.now() - new Date(since).getTime() > STALE_BUILD_MS;
};

export interface CompileService {
  compile(projectId: string, options?: CompileOptions): Promise<Build>;
  /** Stops a queued or running build. */
  cancel(projectId: string, buildId: string): Promise<Build>;
  /** Most recent first. */
  builds(projectId: string, limit?: number): Promise<Build[]>;
  pdf(projectId: string, buildId: string): Promise<ArrayBuffer>;
  openLog(projectId: string, buildId: string): Promise<void>;
  downloadPdf(projectId: string, buildId: string): Promise<void>;
}

export const CompileServiceToken = createToken<CompileService>('CompileService');

export class HttpCompileService implements CompileService {
  constructor(private readonly api: ApiClient) {}

  compile(projectId: string, options: CompileOptions = {}) {
    return this.api.post<Build>(`/projects/${projectId}/compile`, options);
  }

  cancel(projectId: string, buildId: string) {
    return this.api.post<Build>(`/projects/${projectId}/builds/${buildId}/cancel`);
  }

  builds(projectId: string, limit = 5) {
    return this.api.get<Build[]>(`/projects/${projectId}/builds?limit=${limit}`);
  }

  async pdf(projectId: string, buildId: string) {
    const res = await this.api.getRaw(`/projects/${projectId}/builds/${buildId}/pdf`);
    return res.arrayBuffer();
  }

  openLog(projectId: string, buildId: string) {
    return this.api.download(`/projects/${projectId}/builds/${buildId}/log`);
  }

  downloadPdf(projectId: string, buildId: string) {
    return this.api.download(`/projects/${projectId}/builds/${buildId}/pdf`, 'output.pdf');
  }
}
