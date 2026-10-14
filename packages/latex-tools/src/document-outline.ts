// Scanners for the project navigator: figures, tables, equations and acronyms, carrying just enough
// content for a quick client-side preview (image path, tabular source, equation TeX, acronym text).
// Bounded quantifiers (ReDoS), same discipline as reference-index.ts, and no `\s*(?:[..])?\s*`:
// two adjacent `\s*` split a run of spaces every possible way (quadratic). Matches are scanned
// forward once (cursor, envBlocks), never rescanned from each match to the line start or file end.
const COMMENT_START = /(?<!\\)%/;
const TABLE_SOURCE_CAP = 8000;
const EQ_SOURCE_CAP = 2000;
const TITLE_SCAN_CAP = 2000;
// \caption (not \captionsetup/\captionof); the arg is read with balanced braces so \cite{} inside survives.
const CAPTION = /\\caption\*?(?![a-zA-Z])/;
const LABEL1 = /\\label\s*\{([^}]{0,500})\}/;
const INCLUDEGRAPHICS = /\\includegraphics\s*(?:\[[^\]]{0,300}\]\s*)?\{([^}]{0,400})\}/;
const TABULAR = /\\begin\{tabular\}[\s\S]{0,8000}?\\end\{tabular\}/;
const NEWACRONYM =
  /\\newacronym\s*(?:\[[^\]]{0,200}\]\s*)?\{([^}]{0,100})\}\s*\{([^}]{0,100})\}\s*\{([^}]{0,500})\}/g;
const EQ_ENVS = ['equation', 'align', 'gather', 'multline', 'dmath'];
// Sectioning commands, outermost first: the index is the heading's depth for the document map.
const SECTION_CMDS = ['part', 'chapter', 'section', 'subsection', 'subsubsection'];
const SECTION_RE = /\\(part|chapter|section|subsection|subsubsection)\*?(?![a-zA-Z])/g;
const INPUT_RE = /\\(?:input|include)\s*\{([^}]{0,400})\}/g;

export type Figure = { caption: string; label?: string; image?: string; line: number };
export type DocTable = { caption: string; label?: string; source?: string; line: number };
export type Equation = { label?: string; source: string; line: number };
export type Acronym = { key: string; short: string; long: string; line: number };
export type Section = { level: number; title: string; line: number };

/**
 * For increasing indexes into `source`: the 1-based line, and whether a `%` (not after `\`) comes
 * before it on that line. One forward pass over the source in all, not a rescan per match.
 */
function cursor(source: string) {
  let pos = 0;
  let line = 1;
  let commented = false;
  return (idx: number) => {
    for (; pos < idx; pos++) {
      const c = source[pos];
      if (c === '\n') {
        line++;
        commented = false;
      } else if (c === '%' && source[pos - 1] !== '\\') commented = true;
    }
    return { line, commented };
  };
}

/** Balanced `{...}` content after the first match of `re` (skips one optional `[..]`). null if none. */
function bracedArg(text: string, re: RegExp): string | null {
  const m = re.exec(text);
  if (!m) return null;
  let i = (m.index ?? 0) + m[0].length;
  while (i < text.length && /\s/.test(text[i] as string)) i++;
  if (text[i] === '[') {
    for (i++; i < text.length && text[i] !== ']'; i++);
    i++;
    while (i < text.length && /\s/.test(text[i] as string)) i++;
  }
  if (text[i] !== '{') return null;
  let depth = 0;
  const start = i + 1;
  for (; i < text.length; i++) {
    const c = text[i];
    if (c === '\\') i++;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return text.slice(start, i);
  }
  return null;
}

/** Each non-commented `\begin{name}…\end{name}` block: its inner body and the \begin line (1-based). */
function envBlocks(source: string, name: string): { body: string; line: number }[] {
  const at = cursor(source);
  const begins = [...source.matchAll(new RegExp(`\\\\begin\\{${name}\\*?\\}`, 'g'))].flatMap(
    (m) => {
      const { line, commented } = at(m.index);
      return commented ? [] : [{ start: m.index, bodyStart: m.index + m[0].length, line }];
    },
  );
  const end = new RegExp(`\\\\end\\{${name}\\*?\\}`, 'g');
  let endAt = -1; // the first \end at or after the last search; source.length when none is left
  return begins.map(({ bodyStart, line }, i) => {
    if (endAt < bodyStart) {
      end.lastIndex = bodyStart;
      endAt = end.exec(source)?.index ?? source.length;
    }
    // These envs never nest, so a body also stops at the next \begin: bodies stay disjoint and an
    // unclosed \begin costs one scan, not one to the end of the file per \begin (ReDoS).
    const next = begins[i + 1]?.start ?? source.length;
    return { body: source.slice(bodyStart, Math.min(endAt, next)), line };
  });
}

export function findFigures(source: string): Figure[] {
  return envBlocks(source, 'figure').map(({ body, line }) => {
    const label = LABEL1.exec(body)?.[1]?.trim();
    const image = INCLUDEGRAPHICS.exec(body)?.[1]?.trim();
    return {
      caption: (bracedArg(body, CAPTION) ?? '').trim(),
      ...(label ? { label } : {}),
      ...(image ? { image } : {}),
      line,
    };
  });
}

export function findTables(source: string): DocTable[] {
  return envBlocks(source, 'table').map(({ body, line }) => {
    const label = LABEL1.exec(body)?.[1]?.trim();
    const tab = TABULAR.exec(body)?.[0];
    return {
      caption: (bracedArg(body, CAPTION) ?? '').trim(),
      ...(label ? { label } : {}),
      ...(tab && tab.length <= TABLE_SOURCE_CAP ? { source: tab } : {}),
      line,
    };
  });
}

/** KaTeX-ready TeX: align/gather need an aligned/gathered wrapper, equation/multline render as-is. */
function forKatex(env: string, body: string): string {
  if (env.startsWith('align')) return `\\begin{aligned}${body}\\end{aligned}`;
  if (env.startsWith('gather')) return `\\begin{gathered}${body}\\end{gathered}`;
  return body;
}

export function findEquations(source: string): Equation[] {
  const out: (Equation & { line: number })[] = [];
  for (const env of EQ_ENVS) {
    for (const { body, line } of envBlocks(source, env)) {
      const label = LABEL1.exec(body)?.[1]?.trim();
      const tex = forKatex(env, body.replace(/\\label\s*\{[^}]{0,500}\}/g, '').trim());
      if (tex && tex.length <= EQ_SOURCE_CAP)
        out.push({ ...(label ? { label } : {}), source: tex, line });
    }
  }
  return out.sort((a, b) => a.line - b.line);
}

/** Sectioning commands in document order, with a 0-based depth (part=0 … subsubsection=4). */
export function findSections(source: string): Section[] {
  const out: Section[] = [];
  const at = cursor(source);
  const matches = [...source.matchAll(SECTION_RE)];
  for (const [i, m] of matches.entries()) {
    const start = m.index;
    const { line, commented } = at(start);
    if (commented) continue;
    const cmd = m[1] as string;
    // The slice puts the command at index 0; bracedArg then skips an optional [short]. It ends at
    // the next sectioning command (a title holds none) and is capped, or every unclosed
    // `\section{` would scan on to the end of the file.
    const next = Math.min(start + TITLE_SCAN_CAP, matches[i + 1]?.index ?? source.length);
    const text = source.slice(start, next);
    const title = bracedArg(text, new RegExp(`\\\\${cmd}\\*?`)) ?? '';
    out.push({ level: SECTION_CMDS.indexOf(cmd), title: title.trim(), line });
  }
  return out;
}

/** `\input`/`\include` targets in document order (raw args, no extension resolution). */
export function findInputs(source: string): string[] {
  const out: string[] = [];
  for (const text of source.split('\n')) {
    const cut = text.search(COMMENT_START);
    const code = cut === -1 ? text : text.slice(0, cut);
    for (const m of code.matchAll(INPUT_RE)) out.push((m[1] ?? '').trim());
  }
  return out;
}

export function findAcronyms(source: string): Acronym[] {
  const out: Acronym[] = [];
  source.split('\n').forEach((text, i) => {
    const cut = text.search(COMMENT_START);
    const code = cut === -1 ? text : text.slice(0, cut);
    for (const m of code.matchAll(NEWACRONYM)) {
      const key = (m[1] ?? '').trim();
      if (key)
        out.push({ key, short: (m[2] ?? '').trim(), long: (m[3] ?? '').trim(), line: i + 1 });
    }
  });
  return out;
}
