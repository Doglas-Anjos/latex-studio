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
export interface SectionItem {
  /** 0 = part … 4 = subsubsection. */
  level: number;
  title: string;
  path: string;
  line: number;
}
/** Sections, figures, tables, equations and acronyms of a project, for the navigator and map. */
export interface DocumentOutline {
  sections: SectionItem[];
  figures: FigureItem[];
  tables: TableItem[];
  equations: EquationItem[];
  acronyms: AcronymItem[];
}

/** A document's "subject graph": frequent terms as nodes, co-occurrence in a paragraph as edges. */
export interface TopicGraph {
  nodes: { term: string; count: number }[];
  edges: { a: string; b: string; weight: number }[];
}

export interface ReferenceService {
  index(projectId: string): Promise<ReferenceIndex>;
  outline(projectId: string): Promise<DocumentOutline>;
  topics(projectId: string): Promise<TopicGraph>;
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

  topics(projectId: string) {
    return this.api.get<TopicGraph>(`/projects/${projectId}/references/topics`);
  }
}
