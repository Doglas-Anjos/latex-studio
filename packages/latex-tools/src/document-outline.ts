// Scanners for the project navigator: figures, tables, equations and acronyms, carrying just enough
// content for a quick client-side preview (image path, tabular source, equation TeX, acronym text).
// Bounded quantifiers (ReDoS), same discipline as reference-index.ts.
const COMMENT_START = /(?<!\\)%/;
const TABLE_SOURCE_CAP = 8000;
const EQ_SOURCE_CAP = 2000;
// \caption (not \captionsetup/\captionof); the arg is read with balanced braces so \cite{} inside survives.
const CAPTION = /\\caption\*?(?![a-zA-Z])/;
const LABEL1 = /\\label\s*\{([^}]{0,500})\}/;
const INCLUDEGRAPHICS = /\\includegraphics\s*(?:\[[^\]]{0,300}\])?\s*\{([^}]{0,400})\}/;
const TABULAR = /\\begin\{tabular\}[\s\S]{0,8000}?\\end\{tabular\}/;
const NEWACRONYM =
  /\\newacronym\s*(?:\[[^\]]{0,200}\])?\s*\{([^}]{0,100})\}\s*\{([^}]{0,100})\}\s*\{([^}]{0,500})\}/g;
const EQ_ENVS = ['equation', 'align', 'gather', 'multline', 'dmath'];

export type Figure = { caption: string; label?: string; image?: string; line: number };
export type DocTable = { caption: string; label?: string; source?: string; line: number };
export type Equation = { label?: string; source: string; line: number };
export type Acronym = { key: string; short: string; long: string; line: number };

const lineAt = (source: string, idx: number): number => {
  let line = 1;
  for (let i = 0; i < idx; i++) if (source[i] === '\n') line++;
  return line;
};

const commented = (source: string, idx: number): boolean =>
  COMMENT_START.test(source.slice(source.lastIndexOf('\n', idx) + 1, idx));

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
  const out: { body: string; line: number }[] = [];
  const begin = new RegExp(`\\\\begin\\{${name}\\*?\\}`, 'g');
  for (const m of source.matchAll(begin)) {
    const start = m.index ?? 0;
    if (commented(source, start)) continue;
    const bodyStart = start + m[0].length;
    const end = new RegExp(`\\\\end\\{${name}\\*?\\}`, 'g');
    end.lastIndex = bodyStart;
    const e = end.exec(source);
    out.push({
      body: source.slice(bodyStart, e ? e.index : source.length),
      line: lineAt(source, start),
    });
  }
  return out;
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
