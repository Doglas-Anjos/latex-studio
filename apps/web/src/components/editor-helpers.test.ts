import { ensureSyntaxTree } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { latexLanguage } from 'codemirror-lang-latex';
import { describe, expect, it } from 'vitest';
import { helperAt, inputPaths } from './editor-helpers';

const doc = String.raw`\input{./cap1}
\includegraphics[width=2cm]{fig}
See \ref{sec} and $x^2$.
\begin{tabular}{cc}
a & $y$ \\
\includegraphics{} & b \\
\end{tabular}
\begin{tabular}{ll}
N & \begin{tabular}{l}1\\ 2\end{tabular} \\
\end{tabular}`;
const state = EditorState.create({ doc, extensions: latexLanguage.extension });
ensureSyntaxTree(state, state.doc.length, 5000);
const at = (needle: string, offset = 1, assoc: -1 | 1 = 1) =>
  helperAt(state, doc.indexOf(needle) + offset, assoc);

describe('helperAt', () => {
  it('finds files with the paths LaTeX would read', () => {
    expect(at('cap1')).toMatchObject({ kind: 'file', paths: ['cap1.tex'] });
    expect(at('fig}')?.paths).toEqual(
      ['.pdf', '.png', '.jpg', '.jpeg', '.eps'].map((e) => `fig${e}`),
    );
    expect(inputPaths(' ./img/a.png ', true)).toEqual(['img/a.png']);
  });

  it('prefers the innermost target, on the side the pointer is', () => {
    expect(at('sec')?.kind).toBe('ref');
    expect(at('x^2')?.kind).toBe('formula');
    expect(at('$y$')?.kind).toBe('formula');
    // Right half of the closing `$`: the position after it, seen from the left.
    expect(at('$y$', 3, -1)?.kind).toBe('formula');
    const table = at('a & $y$', 0);
    expect(table?.kind).toBe('table');
    expect(doc.slice(table?.from, table?.caret)).toBe(String.raw`\begin{tabular}{cc}`);
  });

  it('a half-typed command does not hide the table around it', () => {
    expect(at(String.raw`\includegraphics{}`)?.kind).toBe('table');
  });

  it('skips a tabular it cannot rewrite (nested environment), but offers the inner one', () => {
    expect(at('N &', 0)).toBeNull();
    expect(at('1\\', 0)?.kind).toBe('table');
  });
});
