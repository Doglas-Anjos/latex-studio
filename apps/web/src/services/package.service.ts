import { createToken } from '../di/container';
import type { ApiClient } from './api-client';

export interface PackageEntry {
  name: string;
  options?: string;
  enabled: boolean;
  order: number;
}

export interface MigrateResult {
  moved: number;
  manifest?: PackageEntry[];
}

export interface PackageService {
  get(projectId: string): Promise<PackageEntry[]>;
  set(projectId: string, packages: PackageEntry[]): Promise<PackageEntry[]>;
  migrate(projectId: string): Promise<MigrateResult>;
}

export const PackageServiceToken = createToken<PackageService>('PackageService');

export class HttpPackageService implements PackageService {
  constructor(private readonly api: ApiClient) {}

  get(projectId: string) {
    return this.api.get<PackageEntry[]>(`/projects/${projectId}/packages`);
  }

  set(projectId: string, packages: PackageEntry[]) {
    return this.api.put<PackageEntry[]>(`/projects/${projectId}/packages`, { packages });
  }

  migrate(projectId: string) {
    return this.api.post<MigrateResult>(`/projects/${projectId}/packages/migrate`);
  }
}
