import { createToken } from '../di/container';
import type { ApiClient } from './api-client';

export type Role = 'owner' | 'editor' | 'reviewer' | 'viewer';

export interface Project {
  id: string;
  ownerId: string;
  name: string;
  mainFile: string;
  engine: 'pdflatex' | 'xelatex' | 'lualatex';
  createdAt: string;
  updatedAt: string;
  role: Role;
}

/** Either a single .zip or a list of files with their relative paths. */
export type ImportInput =
  | { name: string; archive: File }
  | { name: string; files: { file: File; path: string }[] };

export interface ProjectService {
  list(): Promise<Project[]>;
  get(id: string): Promise<Project>;
  create(name: string): Promise<Project>;
  remove(id: string): Promise<void>;
  import(input: ImportInput): Promise<Project>;
  copy(projectId: string, name?: string): Promise<Project>;
  downloadSource(projectId: string, withHistory?: boolean): Promise<void>;
}

export const ProjectServiceToken = createToken<ProjectService>('ProjectService');

export class HttpProjectService implements ProjectService {
  constructor(private readonly api: ApiClient) {}

  list() {
    return this.api.get<Project[]>('/projects');
  }

  get(id: string) {
    return this.api.get<Project>(`/projects/${id}`);
  }

  create(name: string) {
    return this.api.post<Project>('/projects', { name });
  }

  remove(id: string) {
    return this.api.delete(`/projects/${id}`);
  }

  import(input: ImportInput) {
    const form = new FormData();
    form.append('name', input.name); // the API reads `name` before the files
    if ('archive' in input) form.append('archive', input.archive);
    else for (const { file, path } of input.files) form.append('files', file, path);
    return this.api.postForm<Project>('/projects/import', form);
  }

  copy(projectId: string, name?: string) {
    return this.api.post<Project>(`/projects/${projectId}/copy`, name ? { name } : {});
  }

  downloadSource(projectId: string, withHistory = false) {
    const name = withHistory ? 'source-with-history' : 'source';
    return this.api.download(`/projects/${projectId}/export/${name}.zip`, `${name}.zip`);
  }
}
