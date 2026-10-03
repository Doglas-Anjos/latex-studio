import { createToken } from '../di/container';
import type { ApiClient } from './api-client';

export interface LogEntry {
  file?: string;
  line?: number;
  message: string;
}

export type BuildStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'timeout';

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
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export const isActive = (b?: Build) => b?.status === 'queued' || b?.status === 'running';

export interface CompileService {
  compile(projectId: string): Promise<Build>;
  /** Most recent first. */
  builds(projectId: string, limit?: number): Promise<Build[]>;
  pdf(projectId: string, buildId: string): Promise<ArrayBuffer>;
  openLog(projectId: string, buildId: string): Promise<void>;
  downloadPdf(projectId: string, buildId: string): Promise<void>;
}

export const CompileServiceToken = createToken<CompileService>('CompileService');

export class HttpCompileService implements CompileService {
  constructor(private readonly api: ApiClient) {}

  compile(projectId: string) {
    return this.api.post<Build>(`/projects/${projectId}/compile`);
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
