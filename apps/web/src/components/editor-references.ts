// Cross-reference and citation helpers for the LaTeX editor:
//  - Ctrl/Cmd+click a \ref/\cite key jumps to where it is defined (this file or another).
//  - typing inside \ref{/\cite{ completes the keys known in the project.
//  - a key with no matching \label / bib entry is marked (cm-ref-missing) with a title saying why.
//
// Usages are found with bounded regexes (not the Lezer tree) so natbib/biblatex/cleveref variants
// (\citep, \autocite, \cref, ...) and half-typed braces are all handled, and `%` comments skipped.
import type { CompletionSource } from '@codemirror/autocomplete';
import { type Extension, StateEffect } from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view';
import type { ReferenceIndex } from '../services/reference.service';
import { useWorkspaceStore } from '../workspace-store';

const REF_CMDS = [
  'ref',
  'eqref',
  'autoref',
  'cref',
  'Cref',
  'crefrange',
  'pageref',
  'nameref',
  'vref',
  'vpageref',
  'labelcref',
];
const CITE_CMDS = [
  'cite',
  'citep',
  'citet',
  'citeauthor',
  'citeyear',
  'citealp',
  'citealt',
  'parencite',
  'textcite',
  'footcite',
  'autocite',
  'smartcite',
  'fullcite',
];
const REF_SET = new Set(REF_CMDS);
const CITE_SET = new Set(CITE_CMDS);

// Bounded quantifiers (ReDoS): a half-typed `\cite{` on a huge line must not backtrack for seconds.
const REF_CMD = new RegExp(`\\\\(?:${REF_CMDS.join('|')})\\*?\\s{0,10}\\{([^}]{0,1000})\\}`, 'g');
const CITE_CMD = new RegExp(
  `\\\\(?:${CITE_CMDS.join('|')})\\*?\\s{0,10}(?:\\[[^\\]]{0,200}\\]){0,2}\\s{0,10}\\{([^}]{0,1000})\\}`,
  'g',
);
const LABEL_CMD = /\\label\s{0,10}\{([^}]{0,500})\}/g;
const COMMENT_START = /(?<!\\)%/;

type Usage = { kind: 'ref' | 'cite'; key: string; from: number; to: number };

/** Each comma-separated key in `group` (brace content) with its absolute [from,to), trimmed. */
function segments(group: string, base: number): Array<{ key: string; from: number; to: number }> {
  const out: Array<{ key: string; from: number; to: number }> = [];
  let offset = 0;
  for (const seg of group.split(',')) {
    const lead = seg.length - seg.trimStart().length;
    const key = seg.trim();
    if (key) {
      const from = base + offset + lead;
      out.push({ key, from, to: from + key.length });
    }
    offset += seg.length + 1; // + the comma
  }
  return out;
}

/** Every \ref/\cite key in the document (code only), with its position. Exported for tests. */
export function usages(doc: string): Usage[] {
  const out: Usage[] = [];
  let lineStart = 0;
  for (const line of doc.split('\n')) {
    const cut = line.search(COMMENT_START);
    const code = cut === -1 ? line : line.slice(0, cut);
    for (const [re, kind] of [
      [REF_CMD, 'ref'],
      [CITE_CMD, 'cite'],
    ] as const) {
      for (const m of code.matchAll(re)) {
        const group = m[1] ?? '';
        const base = lineStart + (m.index ?? 0) + m[0].length - 1 - group.length;
        for (const s of segments(group, base)) out.push({ kind, ...s });
      }
    }
    lineStart += line.length + 1; // + the newline
  }
  return out;
}

/** Labels defined in this buffer, so a freshly typed \label isn't flagged by its \ref before save. */
export function localLabels(doc: string): Set<string> {
  const labels = new Set<string>();
  for (const line of doc.split('\n')) {
    const cut = line.search(COMMENT_START);
    const code = cut === -1 ? line : line.slice(0, cut);
    for (const m of code.matchAll(LABEL_CMD)) {
      const key = (m[1] ?? '').trim();
      if (key) labels.add(key);
    }
  }
  return labels;
}

/** Re-read the reference index into the live editor (data arrives after the view is built). */
export const setReferenceIndex = StateEffect.define<null>();

function build(doc: string, index: ReferenceIndex | null): DecorationSet {
  if (!index) return Decoration.none;
  const labels = localLabels(doc);
  for (const l of index.labels) labels.add(l.key);
  const cites = new Set(index.citeKeys.map((c) => c.key));
  const marks = [];
  for (const u of usages(doc)) {
    const defined = u.kind === 'ref' ? labels : cites;
    if (defined.has(u.key)) continue;
    const title =
      u.kind === 'ref'
        ? `Referência "${u.key}" não encontrada — nenhum \\label{${u.key}} no projeto`
        : `Citação "${u.key}" sem entrada na bibliografia (.bib ou \\bibitem)`;
    marks.push(
      Decoration.mark({ class: 'cm-ref-missing', attributes: { title } }).range(u.from, u.to),
    );
  }
  return Decoration.set(marks, true);
}

/** The key under `pos`, if the cursor sits on a \ref/\cite argument. */
function keyAt(doc: string, pos: number): Usage | null {
  for (const u of usages(doc)) if (pos >= u.from && pos <= u.to) return u;
  return null;
}

/**
 * Marks unresolved keys and jumps to a definition on Ctrl/Cmd+click. `path` is the open file so a
 * same-file target scrolls in place and a cross-file one opens the other tab.
 */
export function referenceExtensions(opts: {
  indexRef: { current: ReferenceIndex | null };
  path: string;
}): Extension {
  const marks = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = build(view.state.doc.toString(), opts.indexRef.current);
      }
      update(u: ViewUpdate) {
        if (
          u.docChanged ||
          u.transactions.some((tr) => tr.effects.some((e) => e.is(setReferenceIndex)))
        ) {
          this.decorations = build(u.state.doc.toString(), opts.indexRef.current);
        }
      }
    },
    { decorations: (v) => v.decorations },
  );
  const jump = EditorView.domEventHandlers({
    mousedown(event, view) {
      if (!(event.metaKey || event.ctrlKey) || event.button !== 0) return false;
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (pos == null) return false;
      const hit = keyAt(view.state.doc.toString(), pos);
      const index = opts.indexRef.current;
      if (!hit || !index) return false;
      const def = (hit.kind === 'ref' ? index.labels : index.citeKeys).find(
        (d) => d.key === hit.key,
      );
      if (!def) return false;
      event.preventDefault();
      if (def.path === opts.path) {
        const line = view.state.doc.line(Math.min(Math.max(def.line, 1), view.state.doc.lines));
        view.dispatch({
          selection: { anchor: line.from },
          effects: EditorView.scrollIntoView(line.from, { y: 'center' }),
        });
        view.focus();
      } else {
        useWorkspaceStore.getState().goToLine(def.path, def.line);
      }
      return true;
    },
  });
  return [marks, jump];
}

/** Completes \ref/\cite keys from the project index; the regex handles a still-open brace. */
export function referenceCompletions(indexRef: {
  current: ReferenceIndex | null;
}): CompletionSource {
  return (ctx) => {
    const index = indexRef.current;
    if (!index) return null;
    const line = ctx.state.doc.lineAt(ctx.pos);
    const before = ctx.state.sliceDoc(line.from, ctx.pos);
    const m = /\\(\w+)\*?\s{0,10}(?:\[[^\]]{0,200}\]){0,2}\s{0,10}\{([^}]{0,1000})$/.exec(before);
    if (!m) return null;
    const cmd = m[1] ?? '';
    const kind = REF_SET.has(cmd) ? 'ref' : CITE_SET.has(cmd) ? 'cite' : null;
    if (!kind) return null;
    const typed = m[2] ?? '';
    const seg = typed.slice(typed.lastIndexOf(',') + 1);
    const lead = seg.length - seg.trimStart().length;
    const from = ctx.pos - (seg.length - lead);
    const defs = kind === 'ref' ? index.labels : index.citeKeys;
    const seen = new Set<string>();
    const options = [];
    for (const d of defs) {
      if (seen.has(d.key)) continue;
      seen.add(d.key);
      options.push({
        label: d.key,
        type: kind === 'ref' ? 'variable' : 'constant',
        detail: d.path,
      });
    }
    if (options.length === 0) return null;
    return { from, options, validFor: /^[^,{}\s]*$/ };
  };
}
