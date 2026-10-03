import { createToken } from '../di/container';
import type { ApiClient } from './api-client';

export type ExportFormat = 'docx' | 'md' | 'html';

export interface WordCount {
  words?: number;
  headers?: number;
  captions?: number;
  raw: string;
}

export interface JobStatus<T = unknown> {
  state: string;
  result?: T;
  error?: string;
}

export interface ToolsService {
  wordCount(projectId: string): Promise<{ jobId: string }>;
  requestExport(projectId: string, format: ExportFormat): Promise<{ jobId: string }>;
  jobStatus<T = unknown>(projectId: string, jobId: string): Promise<JobStatus<T>>;
  downloadJobFile(projectId: string, jobId: string, filename: string): Promise<void>;
}

export const ToolsServiceToken = createToken<ToolsService>('ToolsService');

export class HttpToolsService implements ToolsService {
  constructor(private readonly api: ApiClient) {}

  wordCount(projectId: string) {
    return this.api.post<{ jobId: string }>(`/projects/${projectId}/wordcount`);
  }

  requestExport(projectId: string, format: ExportFormat) {
    return this.api.post<{ jobId: string }>(`/projects/${projectId}/export/${format}`);
  }

  jobStatus<T = unknown>(projectId: string, jobId: string) {
    return this.api.get<JobStatus<T>>(`/projects/${projectId}/jobs/${jobId}`);
  }

  downloadJobFile(projectId: string, jobId: string, filename: string) {
    return this.api.download(`/projects/${projectId}/jobs/${jobId}/file`, filename);
  }
}
