import { createToken } from '../di/container';
import type { ApiClient } from './api-client';

export type RefLocation = { key: string; path: string; line: number };
/** Where every label and citation key of a project is defined, for cross-file resolution. */
export interface ReferenceIndex {
  labels: RefLocation[];
  citeKeys: RefLocation[];
}

export interface ReferenceService {
  index(projectId: string): Promise<ReferenceIndex>;
}

export const ReferenceServiceToken = createToken<ReferenceService>('ReferenceService');

export class HttpReferenceService implements ReferenceService {
  constructor(private readonly api: ApiClient) {}

  index(projectId: string) {
    return this.api.get<ReferenceIndex>(`/projects/${projectId}/references`);
  }
}
