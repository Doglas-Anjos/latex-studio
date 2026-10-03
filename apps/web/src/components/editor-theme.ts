import { HighlightStyle } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import { tags as t } from '@lezer/highlight';
import type { SyntaxToken } from '../settings-store';

/** Which lezer tags paint with which `--syn-*` variable. */
export const TOKEN_FOR_TAG: {
  tag: Parameters<typeof HighlightStyle.define>[0][number]['tag'];
  token: SyntaxToken;
  extra?: Record<string, string>;
}[] = [
  { tag: [t.keyword, t.definitionKeyword], token: 'command' },
  { tag: t.className, token: 'env' },
  { tag: [t.processingInstruction, t.variableName], token: 'math' },
  { tag: [t.bracket, t.operator], token: 'brace' },
  { tag: t.string, token: 'string' },
  { tag: [t.labelName, t.quote], token: 'ref' },
  { tag: t.heading, token: 'heading', extra: { fontWeight: '600' } },
  { tag: t.comment, token: 'comment', extra: { fontStyle: 'italic' } },
  { tag: t.number, token: 'number' },
  { tag: [t.meta, t.monospace], token: 'verbatim' },
  { tag: t.emphasis, token: 'emphasis', extra: { fontStyle: 'italic' } },
  { tag: t.strong, token: 'emphasis', extra: { fontWeight: 'bold' } },
  { tag: t.invalid, token: 'invalid' },
];

export const latexHighlight = HighlightStyle.define(
  TOKEN_FOR_TAG.map(({ tag, token, extra }) => ({ tag, color: `var(--syn-${token})`, ...extra })),
);

export const editorTheme = EditorView.theme({
  '&': { height: '100%', color: 'var(--ink)', backgroundColor: 'var(--surface)' },
  '.cm-scroller': { fontFamily: 'var(--editor-font)', fontSize: 'var(--editor-font-size)' },
  '.cm-gutters': { backgroundColor: 'var(--paper)', color: 'var(--muted)', border: 'none' },
  '.cm-activeLine, .cm-activeLineGutter': {
    backgroundColor: 'color-mix(in srgb, var(--line) 40%, transparent)',
  },
  '.cm-cursor': { borderLeftColor: 'var(--ink)' },
});
