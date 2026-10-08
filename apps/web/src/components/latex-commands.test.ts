import { ensureSyntaxTree } from '@codemirror/language';
import { EditorSelection, EditorState } from '@codemirror/state';
import { latexLanguage } from 'codemirror-lang-latex';
import { describe, expect, it } from 'vitest';
import { insertList, insertMath, setHeading, type Target, toggleCommand } from './latex-commands';

/** Runs `cmd` on `doc`, where `|` is the caret and `[…]` a selection; returns the doc marked the same way. */
function run(doc: string, cmd: (t: Target) => boolean): string {
  const from = doc.search(/[|[]/);
  const to = doc.includes('[') ? doc.indexOf(']') - 1 : from;
  let state = EditorState.create({
    doc: doc.replace(/[|[\]]/g, ''),
    selection: EditorSelection.single(from, to),
    extensions: latexLanguage.extension,
  });
  ensureSyntaxTree(state, state.doc.length, 5000);
  cmd({ state, dispatch: (tr) => (state = tr.state) });
  const { from: a, to: b } = state.selection.main;
  const text = state.doc.toString();
  return a === b
    ? `${text.slice(0, a)}|${text.slice(a)}`
    : `${text.slice(0, a)}[${text.slice(a, b)}]${text.slice(b)}`;
}

describe('latex commands', () => {
  it('wraps a selection in bold and unwraps it from inside', () => {
    expect(run('a [b] c', toggleCommand('textbf'))).toBe(String.raw`a \textbf{[b]} c`);
    expect(run(String.raw`a \textbf{b|c} d`, toggleCommand('textbf'))).toBe('a b|c d');
    // Unclosed: wrap again rather than eat the last character.
    expect(run(String.raw`\textbf{ab|c`, toggleCommand('textbf'))).toBe(
      String.raw`\textbf{ab\textbf{|}c`,
    );
    expect(run(String.raw`\textbf{a \textit{x|}}`, toggleCommand('textit'))).toBe(
      String.raw`\textbf{a x|}`,
    );
  });

  it('sets, swaps and removes a heading on the caret line', () => {
    const section = run('Intro|', setHeading('section'));
    expect(section).toBe(String.raw`\section{Intro|}`);
    expect(run(section, setHeading('subsection'))).toBe(String.raw`\subsection{Intro|}`);
    expect(run(String.raw`  \section*{Intro|}`, setHeading(null))).toBe('  Intro|');
    expect(run(String.raw`\section{Intro|}\label{s}`, setHeading(null))).toBe(
      String.raw`Intro|\label{s}`,
    );
    expect(run(String.raw`\section*{Lo|ng}`, setHeading('subsection'))).toBe(
      String.raw`\subsection*{Lo|ng}`,
    );
  });

  it('turns selected lines into items', () => {
    expect(run('[one\ntwo\n]three', insertList('itemize'))).toBe(
      String.raw`\begin{itemize}
  \item one
  \item two
\end{itemize}|
three`,
    );
  });

  it('inserts palette math with fields, wrapping in $ outside math', () => {
    expect(run('x |', (t) => insertMath(t, String.raw`\frac{}{}`))).toBe(
      String.raw`x $\frac{|}{}$`,
    );
    expect(run('$a|$', (t) => insertMath(t, String.raw`\alpha`))).toBe(String.raw`$a\alpha |$`);
    expect(run('$|x$', (t) => insertMath(t, String.raw`\alpha`))).toBe(String.raw`$\alpha |x$`);
    expect(run('|', (t) => insertMath(t, String.raw`\left\{ \right.`))).toBe(
      String.raw`$\left\{ \right.|$`,
    );
  });
});
