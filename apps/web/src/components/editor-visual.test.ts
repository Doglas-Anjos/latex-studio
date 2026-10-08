// @vitest-environment jsdom
import { ensureSyntaxTree } from '@codemirror/language';
import { EditorSelection, EditorState } from '@codemirror/state';
import { expect, it } from 'vitest';

import { buildDecorations } from './editor-visual';
import { latexSupport } from './latex-language';

const doc = String.raw`\begin{document}
\section{Intro}
$a^2$
\input{cap}
\begin{enumerate}
\item one
\item two
\end{enumerate}
\end{document}`;

/** Replaced ranges with the text their widget shows (empty string for a plain hide). */
function replaced(caret: number) {
  const state = EditorState.create({
    doc,
    selection: EditorSelection.cursor(caret),
    extensions: [latexSupport()],
  });
  ensureSyntaxTree(state, doc.length, 5000);
  const out: { text: string; widget: boolean }[] = [];
  buildDecorations(state, () => {}).between(0, doc.length, (from, to, d) => {
    if (!d.spec.widget && !d.spec.class)
      out.push({ text: state.sliceDoc(from, to), widget: false });
    else if (d.spec.widget) out.push({ text: state.sliceDoc(from, to), widget: true });
  });
  return out;
}

it('hides heading markup unless the caret is inside it', () => {
  const away = replaced(doc.length - 20).map((r) => r.text);
  expect(away).toContain(String.raw`\section{`);
  expect(away).toContain('}');
  const inside = doc.indexOf('Intro') + 2;
  expect(replaced(inside).map((r) => r.text)).not.toContain(String.raw`\section{`);
});

it('replaces math, \\input and list items with widgets', () => {
  const widgets = replaced(0)
    .filter((r) => r.widget)
    .map((r) => r.text);
  expect(widgets).toEqual([
    '$a^2$',
    String.raw`\input{cap}`,
    String.raw`\item`,
    String.raw`\item`,
    String.raw`\end{document}`,
  ]);
});

it('numbers enumerate items', () => {
  const state = EditorState.create({ doc, extensions: [latexSupport()] });
  ensureSyntaxTree(state, doc.length, 5000);
  const labels: string[] = [];
  buildDecorations(state, () => {}).between(0, doc.length, (_f, _t, d) => {
    const w = d.spec.widget;
    if (w?.text) labels.push(w.text);
  });
  expect(labels).toEqual(['1.', '2.', 'Fim do documento']);
});
