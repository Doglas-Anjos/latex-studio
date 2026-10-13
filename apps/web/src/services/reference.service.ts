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

/** A node of the subject map: the document (root), a chapter (hub) or a characteristic term. */
export interface SubjectNode {
  id: string;
  label: string;
  kind: 'root' | 'hub' | 'term';
  count: number;
  /** Where a click jumps: a hub's heading, a term's first use in its chapter. */
  path?: string;
  line?: number;
}
/** The document as a big picture: root → chapters → the terms that characterise each chapter. */
export interface SubjectGraph {
  nodes: SubjectNode[];
  links: { source: string; target: string; weight: number }[];
}

export interface ReferenceService {
  index(projectId: string): Promise<ReferenceIndex>;
  outline(projectId: string): Promise<DocumentOutline>;
  topics(projectId: string): Promise<SubjectGraph>;
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
    return this.api.get<SubjectGraph>(`/projects/${projectId}/references/topics`);
  }
}
