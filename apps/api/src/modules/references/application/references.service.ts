import {
  type Acronym,
  type DocTable,
  type Equation,
  type Figure,
  findAcronyms,
  findBibEntries,
  findBibItems,
  findEquations,
  findFigures,
  findLabels,
  findTables,
} from '@latex-studio/latex-tools';
import { Inject, Injectable } from '@nestjs/common';
import type { Project } from '../../projects/domain/project';
import {
  PROJECT_STORAGE,
  type ProjectFiles,
  type ProjectStorage,
} from '../../projects/domain/project-storage';

const MAX_SCAN_BYTES = 1024 * 1024;

export type RefLocation = { key: string; path: string; line: number };
/** Where every label and citation key of a project is defined, for cross-file resolution. */
export type ReferenceIndex = { labels: RefLocation[]; citeKeys: RefLocation[] };

type AtPath<T> = T & { path: string };
/** Figures, tables, equations and acronyms of a project, for the navigator panel. */
export type DocumentOutline = {
  figures: AtPath<Figure>[];
  tables: AtPath<DocTable>[];
  equations: AtPath<Equation>[];
  acronyms: AtPath<Acronym>[];
};

@Injectable()
export class ReferencesService {
  constructor(@Inject(PROJECT_STORAGE) private readonly storage: ProjectStorage) {}

  index(project: Project): Promise<ReferenceIndex> {
    return this.scan(this.storage.open(project.id));
  }

  outline(project: Project): Promise<DocumentOutline> {
    return this.scanOutline(this.storage.open(project.id));
  }

  /** Figures, tables, equations and acronyms across every .tex (source scan; no compiled data). */
  private async scanOutline(files: ProjectFiles): Promise<DocumentOutline> {
    const out: DocumentOutline = { figures: [], tables: [], equations: [], acronyms: [] };
    for (const f of await files.repo.listFiles()) {
      if (f.size > MAX_SCAN_BYTES || !/\.tex$/i.test(f.path)) continue;
      const source = Buffer.from(await files.repo.readFile(f.path)).toString('utf8');
      for (const d of findFigures(source)) out.figures.push({ ...d, path: f.path });
      for (const d of findTables(source)) out.tables.push({ ...d, path: f.path });
      for (const d of findEquations(source)) out.equations.push({ ...d, path: f.path });
      for (const d of findAcronyms(source)) out.acronyms.push({ ...d, path: f.path });
    }
    return out;
  }

  /**
   * `\label` in every .tex, citation keys from `\bibitem` (.tex) and `@type{key,` (.bib).
   * ponytail: does not follow `\input` outside the project nor resolve macro-built keys.
   */
  private async scan(files: ProjectFiles): Promise<ReferenceIndex> {
    const labels: RefLocation[] = [];
    const citeKeys: RefLocation[] = [];
    for (const f of await files.repo.listFiles()) {
      if (f.size > MAX_SCAN_BYTES) continue;
      const tex = /\.tex$/i.test(f.path);
      const bib = /\.bib$/i.test(f.path);
      if (!tex && !bib) continue;
      const source = Buffer.from(await files.repo.readFile(f.path)).toString('utf8');
      if (tex) {
        for (const d of findLabels(source)) labels.push({ ...d, path: f.path });
        for (const d of findBibItems(source)) citeKeys.push({ ...d, path: f.path });
      } else {
        for (const d of findBibEntries(source)) citeKeys.push({ ...d, path: f.path });
      }
    }
    return { labels, citeKeys };
  }
}
