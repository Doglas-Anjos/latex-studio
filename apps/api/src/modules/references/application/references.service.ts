import { APP_CONFIG, type AppConfig } from '@latex-studio/core';
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
  findInputs,
  findLabels,
  findMainFile,
  findSections,
  findTables,
  type Section,
  type SubjectGraph,
  subjectGraph,
} from '@latex-studio/latex-tools';
import { Inject, Injectable } from '@nestjs/common';
import type { Project } from '../../projects/domain/project';
import {
  PROJECT_STORAGE,
  type ProjectFiles,
  type ProjectStorage,
} from '../../projects/domain/project-storage';

const MAX_SCAN_BYTES = 1024 * 1024;
// ponytail: the parsers run on the API's event loop (shared with Hocuspocus); they are linear, but a
// hostile 4 MB still costs ~1 s on the subject graph. Files past the total are skipped in listing
// order; move the scans to a worker thread if real projects outgrow it.
const MAX_TOTAL_BYTES = 4 * 1024 * 1024;
const MAX_AREA_PROJECTS = 500;

export type RefLocation = { key: string; path: string; line: number };
/** Where every label and citation key of a project is defined, for cross-file resolution. */
export type ReferenceIndex = { labels: RefLocation[]; citeKeys: RefLocation[] };

type AtPath<T> = T & { path: string };
/** Sections, figures, tables, equations and acronyms of a project, for the navigator and map. */
export type DocumentOutline = {
  sections: AtPath<Section>[];
  figures: AtPath<Figure>[];
  tables: AtPath<DocTable>[];
  equations: AtPath<Equation>[];
  acronyms: AtPath<Acronym>[];
};

const DOCUMENT = /\\begin\s*\{document\}/;
/**
 * The main file with its preamble blanked (non-newline chars → spaces), so `\section`/`\input` in
 * the preamble (e.g. in a customizations file) are skipped while line numbers stay exact. Files
 * without `\begin{document}` (the chapters) are returned unchanged.
 */
function bodyOnly(source: string): string {
  const m = DOCUMENT.exec(source);
  if (!m) return source;
  return source.slice(0, m.index).replace(/[^\n]/g, ' ') + source.slice(m.index);
}

/** `arg` resolved to an existing project .tex (root-relative or next to the including file), or null. */
function resolveInput(arg: string, fromPath: string, has: (p: string) => boolean): string | null {
  const dir = fromPath.includes('/') ? fromPath.slice(0, fromPath.lastIndexOf('/') + 1) : '';
  const bases = [arg.replace(/^\.\//, ''), `${dir}${arg.replace(/^\.\//, '')}`];
  const cands = bases.flatMap((b) => (/\.tex$/i.test(b) ? [b] : [`${b}.tex`, b]));
  return cands.find(has) ?? null;
}

@Injectable()
export class ReferencesService {
  /**
   * Each project's last subject areas (term → area), so the next map evolves from them.
   * ponytail: in memory, per API instance — a restart (or another instance) regroups from scratch
   * once; persist it if the map must stay stable across deploys.
   */
  private readonly areas = new Map<string, Map<string, string>>();

  constructor(
    @Inject(PROJECT_STORAGE) private readonly storage: ProjectStorage,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  index(project: Project): Promise<ReferenceIndex> {
    return this.scan(this.storage.open(project.id));
  }

  outline(project: Project): Promise<DocumentOutline> {
    return this.scanOutline(this.storage.open(project.id));
  }

  /** The document's areas of interest (body only), evolved from this project's last areas. */
  async topics(project: Project): Promise<SubjectGraph> {
    const { order, seen, body } = await this.readOrdered(this.storage.open(project.id));
    const { graph, areas } = subjectGraph(
      order.filter((p) => seen.has(p)).map((path) => ({ path, source: body(path) })),
      project.name,
      {
        // Unset → scaled to the document; set in the env → fixed for every project.
        areas: this.config.SUBJECT_GRAPH_AREAS,
        perArea: this.config.SUBJECT_GRAPH_TERMS,
        previous: this.areas.get(project.id) ?? new Map(),
      },
    );
    // Re-inserted so the Map's first key is the least recently used one, evicted past the cap.
    this.areas.delete(project.id);
    this.areas.set(project.id, areas);
    const [oldest] = this.areas.keys();
    if (oldest && this.areas.size > MAX_AREA_PROJECTS) this.areas.delete(oldest);
    return graph;
  }

  /** The project's files matching `re`, each up to 1 MB and MAX_TOTAL_BYTES in all. */
  private async read(files: ProjectFiles, re: RegExp): Promise<Map<string, string>> {
    const sources = new Map<string, string>();
    let budget = MAX_TOTAL_BYTES;
    for (const f of await files.repo.listFiles()) {
      if (f.size > MAX_SCAN_BYTES || f.size > budget || !re.test(f.path)) continue;
      budget -= f.size;
      sources.set(f.path, Buffer.from(await files.repo.readFile(f.path)).toString('utf8'));
    }
    return sources;
  }

  /**
   * Reads every .tex and returns them in reading order — the `\input`/`\include` chain from the
   * main file, then any unreached file. `body(path)` blanks the main file's preamble; `seen` holds
   * the files reached from the main file's body.
   */
  private async readOrdered(files: ProjectFiles) {
    const sources = await this.read(files, /\.tex$/i);
    const main = findMainFile(sources);
    const body = (path: string) =>
      path === main ? bodyOnly(sources.get(path) as string) : (sources.get(path) as string);
    const order: string[] = [];
    const seen = new Set<string>();
    const visit = (path: string) => {
      if (seen.has(path) || !sources.has(path)) return;
      seen.add(path);
      order.push(path);
      for (const arg of findInputs(body(path))) {
        const next = resolveInput(arg, path, (p) => sources.has(p));
        if (next) visit(next);
      }
    };
    if (main) visit(main);
    for (const p of sources.keys()) if (!seen.has(p)) order.push(p);
    return { sources, order, seen, body };
  }

  /**
   * Sections, figures, tables, equations and acronyms across every .tex (source scan), in reading
   * order so the section map nests correctly; any .tex not reached from the main file is last.
   */
  private async scanOutline(files: ProjectFiles): Promise<DocumentOutline> {
    const out: DocumentOutline = {
      sections: [],
      figures: [],
      tables: [],
      equations: [],
      acronyms: [],
    };
    const { sources, order, seen, body } = await this.readOrdered(files);
    for (const path of order) {
      const source = sources.get(path) as string;
      // Sections only from the document body reached from the main file: a preamble/orphan file's
      // sectioning commands are macro definitions, not the document's structure.
      if (seen.has(path))
        for (const d of findSections(body(path))) if (d.title) out.sections.push({ ...d, path });
      for (const d of findFigures(source)) out.figures.push({ ...d, path });
      for (const d of findTables(source)) out.tables.push({ ...d, path });
      for (const d of findEquations(source)) out.equations.push({ ...d, path });
      for (const d of findAcronyms(source)) out.acronyms.push({ ...d, path });
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
    for (const [path, source] of await this.read(files, /\.(tex|bib)$/i)) {
      if (/\.tex$/i.test(path)) {
        for (const d of findLabels(source)) labels.push({ ...d, path });
        for (const d of findBibItems(source)) citeKeys.push({ ...d, path });
      } else {
        for (const d of findBibEntries(source)) citeKeys.push({ ...d, path });
      }
    }
    return { labels, citeKeys };
  }
}
