import { createToken } from '../di/container';
import type { ApiClient } from './api-client';

export type RefLocation = { key: string; path: string; line: number };
/** Where every label and citation key of a project is defined, for cross-file resolution. */
export interface ReferenceIndex {
  labels: RefLocation[];
  citeKeys: RefLocation[];
}

export interface FigureItem {
  caption: string;
  label?: string;
  image?: string;
  path: string;
  line: number;
}
export interface TableItem {
  caption: string;
  label?: string;
  source?: string;
  path: string;
  line: number;
}
export interface EquationItem {
  label?: string;
  source: string;
  path: string;
  line: number;
}
export interface AcronymItem {
  key: string;
  short: string;
  long: string;
  path: string;
  line: number;
}
/** Figures, tables, equations and acronyms of a project, for the navigator panel. */
export interface DocumentOutline {
  figures: FigureItem[];
  tables: TableItem[];
  equations: EquationItem[];
  acronyms: AcronymItem[];
}

export interface ReferenceService {
  index(projectId: string): Promise<ReferenceIndex>;
  outline(projectId: string): Promise<DocumentOutline>;
}

export const ReferenceServiceToken = createToken<ReferenceService>('ReferenceService');

export class HttpReferenceService implements ReferenceService {
  constructor(private readonly api: ApiClient) {}

  index(projectId: string) {
    return this.api.get<ReferenceIndex>(`/projects/${projectId}/references`);
  }

  outline(projectId: string) {
    return this.api.get<DocumentOutline>(`/projects/${projectId}/references/outline`);
  }
}
