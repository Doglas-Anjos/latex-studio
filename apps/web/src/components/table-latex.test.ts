import { ensureSyntaxTree } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { latexLanguage } from 'codemirror-lang-latex';
import { describe, expect, it } from 'vitest';
import { pickTarget } from './table-dialog';
import {
  DEFAULT_OPTIONS,
  deleteRow,
  emptyTable,
  merge,
  parseLatex,
  parseTsv,
  type TableModel,
  type TableOptions,
  toLatex,
} from './table-latex';

const grid = (rows: string[][]): TableModel => ({
  rows: rows.map((r) => r.map((text) => ({ text }))),
  align: rows[0]?.map((_, i) => (['l', 'c', 'r'] as const)[i % 3] ?? 'c') ?? [],
});
const o = (p: Partial<TableOptions> = {}): TableOptions => ({ ...DEFAULT_OPTIONS, ...p });

describe('toLatex', () => {
  it('writes a booktabs float', () => {
    const t = grid([
      ['A', 'B', 'C'],
      ['1', '2', '3'],
    ]);
    const { code, packages } = toLatex(t, o({ caption: 'Cap', label: 'tab:x', source: 'Src' }));
    expect(code).toBe(
      String.raw`\begin{table}[htbp]
  \centering
  \caption{Cap}
  \label{tab:x}
  \begin{tabular}{lcr}
    \toprule
    A & B & C \\
    \midrule
    1 & 2 & 3 \\
    \bottomrule
  \end{tabular}
  \fonte{Src}
\end{table}`,
    );
    expect(packages).toEqual(['booktabs']);
  });

  it('writes a bare tabular and uses cline under a rowspan in grid style', () => {
    const t = grid([
      ['a', 'b'],
      ['', 'c'],
      ['d', 'e'],
    ]);
    const r0 = t.rows[0];
    if (r0?.[0]) r0[0] = { text: 'a', rowspan: 2 };
    const { code, packages } = toLatex(t, o({ style: 'grid', float: false }));
    expect(code).toBe(
      String.raw`\begin{tabular}{|l|c|}
  \hline
  \multirow{2}{*}{a} & b \\
  \cline{2-2}
   & c \\
  \hline
  d & e \\
  \hline
\end{tabular}`,
    );
    expect(packages).toEqual(['multirow']);
  });

  it('combines multicolumn and multirow', () => {
    const t = grid([
      ['x', '', 'y'],
      ['', '', 'z'],
    ]);
    t.rows[0]?.splice(0, 1, { text: 'x', colspan: 2, rowspan: 2 });
    const { code } = toLatex(t, o({ float: false, header: false }));
    expect(code).toContain(String.raw`\multicolumn{2}{l}{\multirow{2}{*}{x}} & y \\`);
    expect(code).toContain(String.raw`\multicolumn{2}{l}{} & z \\`);
  });

  it('escapes special characters in one pass', () => {
    const t = grid([['a_b & 50% \\ ~ ^ {x} $ #']]);
    expect(toLatex(t, o({ float: false })).code).toContain(
      String.raw`a\_b \& 50\% \textbackslash{} \textasciitilde{} \textasciicircum{} \{x\} \$ \#`,
    );
    expect(toLatex(t, o({ float: false, escape: false })).code).toContain('a_b & 50%');
  });

  it('lists packages', () => {
    const t = grid([['a']]);
    expect(toLatex(t, o({ position: 'H' })).packages).toEqual(['booktabs', 'float']);
    expect(toLatex(t, o({ style: 'lines' })).packages).toEqual([]);
  });
});

describe('editing', () => {
  it('merge rejects a rectangle that cuts a span', () => {
    const t = grid([
      ['a', 'b', 'c'],
      ['d', 'e', 'f'],
    ]);
    const m = merge(t, 0, 0, 0, 1);
    expect(m?.rows[0]?.[0]).toEqual({ text: 'a b', colspan: 2 });
    expect(m && merge(m, 0, 1, 1, 2)).toBeNull();
    expect(merge(t, 0, 0, 0, 0)).toBeNull();
  });

  it('deleting a row inside a span shrinks it', () => {
    const t = merge(emptyTable(3, 2), 0, 0, 2, 0);
    expect(t?.rows[0]?.[0]?.rowspan).toBe(3);
    expect(t && deleteRow(t, 1).rows[0]?.[0]?.rowspan).toBe(2);
    expect(t && deleteRow(t, 0).rows[0]?.[0]?.rowspan).toBe(2);
  });
});

describe('parseTsv', () => {
  it('splits rows and cells', () => {
    expect(parseTsv('a\tb\r\nc\td\r\n')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });
});

describe('parseLatex', () => {
  it('round-trips spans, grid style, caption and label', () => {
    const t = grid([
      ['Title', '', 'x'],
      ['a', 'b', 'c'],
      ['d', 'e', 'f'],
    ]);
    t.rows[0]?.splice(0, 1, { text: 'Title', colspan: 2 });
    t.rows[1]?.splice(2, 1, { text: 'c', rowspan: 2 });
    const opts = o({ style: 'grid', caption: 'Cap', label: 'tab:x', escape: false });
    const code = toLatex(t, opts).code;
    const parsed = parseLatex(code);
    expect(parsed).not.toBeNull();
    if (!parsed) return;
    expect(parsed.options).toMatchObject({ style: 'grid', caption: 'Cap', label: 'tab:x' });
    expect(toLatex(parsed.table, { ...opts, ...parsed.options }).code).toBe(code);
  });

  it('keeps trailing empty rows and a multirow over the last rows', () => {
    const t = grid([
      ['A', 'B', 'C'],
      ['', '', ''],
      ['', '', ''],
    ]);
    const opts = o({ escape: false, float: false });
    const code = toLatex(t, opts).code;
    expect(parseLatex(code)?.table.rows).toHaveLength(3);
    t.rows[1]?.splice(0, 1, { text: 'm', rowspan: 2 });
    const code2 = toLatex(t, opts).code;
    const p = parseLatex(code2);
    expect(p && toLatex(p.table, { ...opts, ...p.options }).code).toBe(code2);
  });

  it('drops comments, ignores captionsetup and detects plain style', () => {
    const src = String.raw`\captionsetup{font=small}
\begin{tabular}{ll}
a & b \\
% c & d \\
e & f % x & y
\\
\end{tabular}`;
    const p = parseLatex(src);
    expect(p?.table.rows.map((r) => r.map((c) => c.text))).toEqual([
      ['a', 'b'],
      ['e', 'f'],
    ]);
    expect(p?.options).toMatchObject({ style: 'plain', caption: '' });
    expect(
      toLatex(p?.table ?? emptyTable(1, 1), o({ style: 'plain', float: false })).code,
    ).not.toContain('rule');
  });

  it('caps spans and stays linear on hostile input', () => {
    const big = String.raw`\begin{tabular}{l}\multicolumn{200000}{c}{x}\multirow{1000000000}{*}{y}\end{tabular}`;
    expect(parseLatex(big)?.table.align.length).toBeLessThanOrEqual(101);
    const hostile = String.raw`\begin{tabular}{l}${String.raw`\cline{`.repeat(30000)}\end{tabular}`;
    const t0 = performance.now();
    parseLatex(hostile);
    expect(performance.now() - t0).toBeLessThan(100);
  });

  it('returns null without a tabular', () => {
    expect(parseLatex('hello')).toBeNull();
  });
});

describe('pickTarget', () => {
  it('edits the tabular around the caret, keeping the float around it', () => {
    const doc = String.raw`\begin{table}[h]
\small
\begin{tabular}{cc}
a & b \\
\end{tabular}
\end{table}`;
    const state = EditorState.create({
      doc,
      selection: { anchor: doc.indexOf('b \\') },
      extensions: latexLanguage.extension,
    });
    ensureSyntaxTree(state, state.doc.length, 5000);
    const t = pickTarget(state);
    expect(t.editing).toBe(true);
    expect(doc.slice(t.from, t.to)).toBe(String.raw`\begin{tabular}{cc}
a & b \\
\end{tabular}`);
  });
});
