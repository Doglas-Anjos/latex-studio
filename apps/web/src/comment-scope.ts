/**
 * Pure text-range logic behind the four ways to start a comment: a free
 * selection, the word under the cursor, the line(s) touched by the
 * selection, or the enclosing LaTeX section. No CodeMirror/Yjs types here so
 * it can be unit-tested as plain string/number math.
 */

export type CommentScope = 'selection' | 'word' | 'line' | 'section';

export interface TextRange {
  from: number;
  to: number;
}

export const SCOPE_LABELS: Record<CommentScope, string> = {
  selection: 'Seleção',
  word: 'Palavra',
  line: 'Linha',
  section: 'Seção',
};

const WORD_CHAR = /[\p{L}\p{N}_]/u;

/** Word touching `pos` on either side, including a leading backslash so LaTeX
 * commands like `\section` count as one word. Null if `pos` touches no word. */
export function wordRangeAt(text: string, pos: number): TextRange | null {
  const isWord = (i: number) => i >= 0 && i < text.length && WORD_CHAR.test(text.charAt(i));
  let from = pos;
  let to = pos;
  while (isWord(from - 1)) from--;
  while (isWord(to)) to++;
  if (from === to) return null;
  if (from > 0 && text.charAt(from - 1) === '\\') from--;
  return { from, to };
}

/**
 * Full line(s) spanned by the selection `[from, to)` (or the single line at
 * `from` when collapsed); the trailing line break is excluded. The end is
 * exclusive, so a selection stopping right at the start of the next line does
 * not pull that line in.
 */
export function lineRangeAt(text: string, from: number, to: number): TextRange {
  const start = text.lastIndexOf('\n', from - 1) + 1;
  // Anchor the last line on the final selected character instead of on `to`.
  const lastSelected = to > from ? to - 1 : to;
  const nextNewline = text.indexOf('\n', lastSelected);
  let end = nextNewline === -1 ? text.length : nextNewline;
  // In CRLF text the \r belongs to the break, not to the line.
  if (end > start && text.charAt(end - 1) === '\r') end--;
  return { from: start, to: end };
}

const SECTION_COMMANDS = [
  { name: 'part', level: 0 },
  { name: 'chapter', level: 1 },
  { name: 'section', level: 2 },
  { name: 'subsection', level: 3 },
  { name: 'subsubsection', level: 4 },
  { name: 'paragraph', level: 5 },
  { name: 'subparagraph', level: 6 },
] as const;

// An optional star and spaces may sit between the command and its `{`, and so
// may a single line break -- but not a blank line, which would end the
// paragraph and leave a bare `\section` token behind.
const SECTION_RE = new RegExp(
  `\\\\(${SECTION_COMMANDS.map((s) => s.name)
    .sort((a, b) => b.length - a.length)
    .join('|')})(?![A-Za-z])[ \\t]*\\*?[ \\t]*(?:\\n[ \\t]*)?\\{`,
  'g',
);

interface SectionMatch {
  start: number;
  level: number;
}

/** How many backslashes sit immediately before `index`. */
function backslashesBefore(text: string, index: number): number {
  let n = 0;
  while (index - n - 1 >= 0 && text.charAt(index - n - 1) === '\\') n++;
  return n;
}

/** True when the command's own backslash is itself escaped: `\\section{A}` is a
 * line break followed by the literal text `section{A}`. */
function isEscapedCommand(text: string, start: number): boolean {
  return backslashesBefore(text, start) % 2 === 1;
}

/** True when `index` sits after an unescaped `%` on its own line, so LaTeX
 * reads it as a comment. `\%` prints a percent sign and opens nothing. */
function isCommentedOut(text: string, index: number): boolean {
  const lineStart = text.lastIndexOf('\n', index - 1) + 1;
  for (let i = text.indexOf('%', lineStart); i !== -1 && i < index; i = text.indexOf('%', i + 1)) {
    if (backslashesBefore(text, i) % 2 === 0) return true;
  }
  return false;
}

function sectionMatches(text: string): SectionMatch[] {
  const levelByName = new Map<string, number>(SECTION_COMMANDS.map((s) => [s.name, s.level]));
  const matches: SectionMatch[] = [];
  for (const m of text.matchAll(SECTION_RE)) {
    const start = m.index;
    if (isEscapedCommand(text, start) || isCommentedOut(text, start)) continue;
    matches.push({ start, level: levelByName.get(m[1] ?? '') ?? 0 });
  }
  return matches;
}

/**
 * Range of the section enclosing `pos`: from its `\section`/`\subsection`/...
 * command up to (but not including) the next command of equal or higher
 * level, or the end of the file. If `pos` comes before any section command
 * (or the file has none), the range covers that section-less content.
 */
export function sectionRangeAt(text: string, pos: number): TextRange | null {
  if (text.length === 0) return null;
  const matches = sectionMatches(text);
  if (matches.length === 0) return { from: 0, to: text.length };
  const current = matches.filter((m) => m.start <= pos).at(-1);
  if (!current) return { from: 0, to: matches.at(0)?.start ?? text.length };
  const next = matches.find((m) => m.start > current.start && m.level <= current.level);
  return { from: current.start, to: next ? next.start : text.length };
}

export interface ScopeInput {
  text: string;
  /** Selection bounds, from <= to. */
  from: number;
  to: number;
  /** Cursor position the selection was extended from; word/section use this. */
  head: number;
}

/** Target range for a scope, or null when there is nothing to comment on yet. */
export function scopeRange(input: ScopeInput, scope: CommentScope): TextRange | null {
  const { text, from, to, head } = input;
  switch (scope) {
    case 'selection':
      return from === to ? null : { from, to };
    case 'word':
      return wordRangeAt(text, head);
    case 'line':
      return lineRangeAt(text, from, to);
    case 'section':
      return sectionRangeAt(text, head);
  }
}

/** Explains why a scope has no target, for a clear in-panel error. */
export function scopeEmptyReason(scope: CommentScope): string {
  switch (scope) {
    case 'selection':
      return 'Selecione um trecho de texto para comentar.';
    case 'word':
      return 'Posicione o cursor sobre uma palavra.';
    case 'line':
      return 'A linha está vazia.';
    case 'section':
      return 'O arquivo está vazio.';
  }
}
