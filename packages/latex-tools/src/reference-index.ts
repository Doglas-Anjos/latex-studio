// Definition scanners for cross-reference and citation keys, so the editor can resolve
// \ref{..}/\cite{..} across every file of a project. Usages are found client-side from the Lezer
// tree; here we only collect where each key is DEFINED.
//
// Bounded quantifiers (ReDoS): an unbounded `[^}]*` scans to end of line from every match start,
// which a 1 MB line of `\label{` turns into seconds. Same discipline as usepackage-parser.
const COMMENT_START = /(?<!\\)%/;
const LABEL = /\\label\s{0,50}\{([^}]{0,500})\}/g;
const BIBITEM = /\\bibitem\s{0,20}(?:\[[^\]]{0,200}\]\s{0,20})?\{([^}]{0,500})\}/g;
// A .bib entry: @type{ key, ... }. Not @string/@comment/@preamble (those define no citation).
const BIB_ENTRY = /@([a-zA-Z]{1,40})\s{0,20}\{\s{0,20}([^,\s{}]{1,200})\s{0,20},/g;
const NON_ENTRY = new Set(['string', 'comment', 'preamble']);

export type RefDef = { key: string; line: number };

/** Strips a trailing `%` comment (unless escaped) from a .tex line, then matches `re` for keys. */
function perLine(source: string, re: RegExp): RefDef[] {
  const found: RefDef[] = [];
  source.split('\n').forEach((text, i) => {
    const cut = text.search(COMMENT_START);
    const code = cut === -1 ? text : text.slice(0, cut);
    for (const m of code.matchAll(re)) {
      const key = (m[1] ?? '').trim();
      if (key) found.push({ key, line: i + 1 });
    }
  });
  return found;
}

/** Every `\label{key}` in code (not comments), one entry per label. */
export function findLabels(source: string): RefDef[] {
  return perLine(source, LABEL);
}

/** Every `\bibitem{key}` (thebibliography style), one entry per item. */
export function findBibItems(source: string): RefDef[] {
  return perLine(source, BIBITEM);
}

/** Every `@type{key,` in a .bib file. BibTeX has no `%` comments, so the whole text is scanned. */
export function findBibEntries(bib: string): RefDef[] {
  const found: RefDef[] = [];
  let line = 1;
  let last = 0;
  for (const m of bib.matchAll(BIB_ENTRY)) {
    const idx = m.index ?? 0;
    for (let i = last; i < idx; i++) if (bib[i] === '\n') line++;
    last = idx;
    if (NON_ENTRY.has((m[1] ?? '').toLowerCase())) continue;
    const key = (m[2] ?? '').trim();
    if (key) found.push({ key, line });
  }
  return found;
}
