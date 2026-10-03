import { createToken } from '../di/container';
import type { ApiClient } from './api-client';

export interface ProjectFile {
  path: string;
  size?: number;
}

export interface FileService {
  list(projectId: string): Promise<ProjectFile[]>;
  /** URL of the raw file (image preview, download). */
  url(projectId: string, path: string): string;
  create(projectId: string, path: string): Promise<void>;
  createFolder(projectId: string, path: string): Promise<void>;
  remove(projectId: string, path: string): Promise<void>;
  rename(projectId: string, from: string, to: string): Promise<void>;
  upload(projectId: string, files: File[], folder?: string): Promise<void>;
}

export const FileServiceToken = createToken<FileService>('FileService');

const encodePath = (path: string) => path.split('/').map(encodeURIComponent).join('/');

export class HttpFileService implements FileService {
  constructor(private readonly api: ApiClient) {}

  list(projectId: string) {
    return this.api.get<ProjectFile[]>(`/projects/${projectId}/files`);
  }

  url(projectId: string, path: string) {
    return `/api/projects/${projectId}/files/${encodePath(path)}`;
  }

  async create(projectId: string, path: string) {
    await this.api.post(`/projects/${projectId}/files`, { path });
  }

  async createFolder(projectId: string, path: string) {
    await this.api.post(`/projects/${projectId}/folders`, { path });
  }

  remove(projectId: string, path: string) {
    return this.api.delete(`/projects/${projectId}/files/${encodePath(path)}`);
  }

  rename(projectId: string, from: string, to: string) {
    return this.api.post<void>(`/projects/${projectId}/files/rename`, { from, to });
  }

  async upload(projectId: string, files: File[], folder?: string) {
    const form = new FormData();
    if (folder) form.append('path', folder); // `path` must come before the files
    for (const file of files) form.append('files', file);
    await this.api.postForm(`/projects/${projectId}/upload`, form);
  }
}
