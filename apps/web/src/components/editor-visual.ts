import { HighlightStyle, syntaxHighlighting, syntaxTree } from '@codemirror/language';
import { type EditorState, type Extension, type Range, StateField } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, WidgetType } from '@codemirror/view';
import { tags as t } from '@lezer/highlight';
import { inputPaths } from './editor-helpers';
import { renderMath } from './katex';
import { latexTags } from './latex-language';

class MathWidget extends WidgetType {
  constructor(
    private readonly tex: string,
    private readonly display: boolean,
  ) {
    super();
  }
  override eq(other: MathWidget) {
    return other.tex === this.tex && other.display === this.display;
  }
  override toDOM(view: EditorView) {
    const el = document.createElement(this.display ? 'div' : 'span');
    el.className = this.display ? 'cm-vis-math cm-vis-math-display' : 'cm-vis-math';
    el.textContent = this.tex;
    renderMath(el, this.tex, this.display)
      .then(() => view.requestMeasure())
      .catch(() => {});
    return el;
  }
  // Clicks reach the editor: the caret lands in the formula and its source shows.
  override ignoreEvent() {
    return false;
  }
}

/** \input / \include shown as a chip; only the icon is clickable, the label reveals the source. */
class ChipWidget extends WidgetType {
  constructor(
    private readonly path: string,
    private readonly openFile: (paths: string[]) => void,
  ) {
    super();
  }
  override eq(other: ChipWidget) {
    return other.path === this.path;
  }
  override toDOM() {
    const el = document.createElement('span');
    el.className = 'cm-vis-chip';
    const icon = document.createElement('span');
    icon.className = 'cm-vis-chip-icon';
    icon.title = 'Abrir arquivo';
    icon.textContent = '↗';
    icon.addEventListener('click', () => this.openFile(inputPaths(this.path, false)));
    const label = document.createElement('span');
    label.className = 'cm-vis-chip-label';
    label.textContent = this.path;
    el.append(icon, label);
    return el;
  }
  override ignoreEvent(e: Event) {
    return e.target instanceof Element && e.target.closest('.cm-vis-chip-icon') != null;
  }
}

/** A fixed piece of text standing in for markup: bullets, numbers, the end-of-document banner. */
class LabelWidget extends WidgetType {
  constructor(
    private readonly text: string,
    private readonly cls: string,
  ) {
    super();
  }
  override eq(other: LabelWidget) {
    return other.text === this.text && other.cls === this.cls;
  }
  override toDOM() {
    const el = document.createElement(this.cls === 'cm-vis-end' ? 'div' : 'span');
    el.className = this.cls;
    el.textContent = this.text;
    return el;
  }
  override ignoreEvent() {
    return false;
  }
}

const HEADING_LEVEL: Record<string, number> = {
  PartCtrlSeq: 1,
  ChapterCtrlSeq: 1,
  SectionCtrlSeq: 2,
  SubSectionCtrlSeq: 3,
  SubSubSectionCtrlSeq: 4,
  ParagraphCtrlSeq: 5,
  SubParagraphCtrlSeq: 6,
};
// ponytail: part and chapter both map to h1; \chapter files use \section in most reports anyway.

const TEXT_STYLE: Record<string, string> = {
  TextBoldCommand: 'cm-vis-bold',
  TextItalicCommand: 'cm-vis-italic',
  EmphasisCommand: 'cm-vis-italic',
  UnderlineCommand: 'cm-vis-underline',
};

const DISPLAY_ENVS = new Set(['EquationEnvironment', 'EquationArrayEnvironment']);
const hide = Decoration.replace({});
type Node = ReturnType<ReturnType<typeof syntaxTree>['resolveInner']>;

function mathDeco(state: EditorState, from: number, to: number, tex: string, display: boolean) {
  const widget = new MathWidget(tex, display);
  const { doc } = state;
  const block = display && doc.lineAt(from).from === from && doc.lineAt(to).to === to;
  return Decoration.replace({ widget, block }).range(from, to);
}

export function buildDecorations(
  state: EditorState,
  openFile: (paths: string[]) => void,
): DecorationSet {
  const { doc } = state;
  const out: Range<Decoration>[] = [];
  const sel = state.selection.ranges;
  const touched = (from: number, to: number) => sel.some((r) => r.from <= to && r.to >= from);
  const lists: { enumerate: boolean; n: number; bullets: boolean }[] = [];

  // `open`/`close` are the delimiter lengths hidden around the styled inner text.
  const wrap = (from: number, to: number, arg: Node, cls: string) => {
    // An argument the user has not closed yet runs to the end and has no `}` to hide.
    const end = arg.lastChild?.name === 'CloseBrace' ? arg.to - 1 : arg.to;
    if (end > arg.from + 1) out.push(Decoration.mark({ class: cls }).range(arg.from + 1, end));
    if (touched(from, to)) return;
    out.push(hide.range(from, arg.from + 1));
    if (end < arg.to) out.push(hide.range(end, arg.to));
  };

  syntaxTree(state).iterate({
    enter(node) {
      const { name, from, to } = node;
      const arg = (n: string) => node.node.getChild(n);
      if (name === 'SectioningCommand') {
        const ctrl = node.node.firstChild;
        const a = arg('SectioningArgument');
        const level = ctrl && HEADING_LEVEL[ctrl.name];
        if (a && level) wrap(from, to, a, `cm-vis-heading cm-vis-h${level}`);
        return;
      }
      if (name in TEXT_STYLE) {
        const a = arg('TextArgument');
        if (a) wrap(from, to, a, TEXT_STYLE[name] as string);
        return;
      }
      if (name === 'DollarMath' || name === 'ParenMath' || name === 'BracketMath') {
        if (touched(from, to)) return false;
        const dollar = node.node.getChild('DisplayMath') != null;
        const n = dollar ? 2 : name === 'DollarMath' ? 1 : 2;
        const tex = doc.sliceString(from + n, to - n);
        out.push(mathDeco(state, from, to, tex, dollar || name === 'BracketMath'));
        return false;
      }
      if (DISPLAY_ENVS.has(name)) {
        if (touched(from, to)) return false;
        const tex = doc.sliceString(from, to).replace(/\\label\{[^}]*\}|\\nonumber|\\notag/g, '');
        out.push(mathDeco(state, from, to, tex, true));
        return false;
      }
      if (name === 'Input' || name === 'Include') {
        const path = /\{([^}]*)\}/.exec(doc.sliceString(from, to))?.[1]?.trim();
        if (!path || touched(from, to)) return false;
        const widget = new ChipWidget(path, openFile);
        out.push(Decoration.replace({ widget }).range(from, to));
        return false;
      }
      if (name === 'EndEnv' && node.node.parent?.name === 'DocumentEnvironment') {
        if (touched(from, to)) return false;
        const widget = new LabelWidget('Fim do documento', 'cm-vis-end');
        const block = doc.lineAt(from).from === from && doc.lineAt(to).to === to;
        out.push(Decoration.replace({ widget, block }).range(from, to));
        return false;
      }
      if (name === 'ListEnvironment') {
        const kind = /^\\begin\{(\w+)/.exec(doc.sliceString(from, Math.min(to, from + 40)))?.[1];
        lists.push({ enumerate: kind === 'enumerate', n: 0, bullets: kind === 'itemize' });
      } else if (name === 'ItemCtrlSeq') {
        const list = lists.at(-1);
        if (!list || !(list.enumerate || list.bullets)) return;
        if (list.enumerate) list.n++;
        if (touched(from, to)) return;
        const text = list.enumerate ? `${list.n}.` : '•';
        out.push(
          Decoration.replace({ widget: new LabelWidget(text, 'cm-vis-bullet') }).range(from, to),
        );
      }
    },
    leave(node) {
      if (node.name === 'ListEnvironment') lists.pop();
    },
  });
  return Decoration.set(out, true);
}

/** Fonts: prose in serif, LaTeX code tokens keep the editor's monospace. */
const codeFont = syntaxHighlighting(
  HighlightStyle.define([
    {
      tag: [
        t.keyword,
        t.definitionKeyword,
        t.className,
        t.processingInstruction,
        t.variableName,
        t.meta,
        t.monospace,
        t.labelName,
        t.url,
        t.string,
        t.bracket,
        t.operator,
        t.number,
        t.heading,
        latexTags.packageName,
        latexTags.option,
        latexTags.mathCommand,
        latexTags.userCommand,
        latexTags.path,
      ],
      fontFamily: 'var(--editor-font)',
    },
  ]),
);

const theme = EditorView.baseTheme({
  '&.cm-visual .cm-content': {
    fontFamily: '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif',
    lineHeight: '1.7',
  },
  '.cm-vis-heading': { fontWeight: '600' },
  '.cm-vis-h1': { fontSize: '1.6em' },
  '.cm-vis-h2': { fontSize: '1.4em' },
  '.cm-vis-h3': { fontSize: '1.25em' },
  '.cm-vis-h4': { fontSize: '1.12em' },
  '.cm-vis-h5': { fontSize: '1.05em' },
  '.cm-vis-h6': { fontSize: '1em' },
  '.cm-vis-bold': { fontWeight: '700' },
  '.cm-vis-italic': { fontStyle: 'italic' },
  '.cm-vis-underline': { textDecoration: 'underline' },
  // Negative \kern/\raisebox escape KaTeX's maxSize: clip so a formula cannot cover other lines.
  '.cm-vis-math': { display: 'inline-block', overflow: 'clip' },
  '.cm-vis-math-display': { display: 'block', textAlign: 'center', padding: '0.4em 0' },
  '.cm-vis-chip': {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    padding: '0 8px',
    borderRadius: '6px',
    border: '1px solid var(--line)',
    background: 'var(--surface)',
    color: 'var(--ink)',
  },
  '.cm-vis-chip-icon': { display: 'inline-flex', cursor: 'pointer', color: 'var(--primary)' },
  '.cm-vis-chip-label': { fontFamily: 'var(--editor-font)', fontSize: '0.85em' },
  '.cm-vis-end': {
    textAlign: 'center',
    color: 'var(--muted)',
    border: '1px dashed var(--line)',
    borderRadius: '6px',
    background: 'var(--paper)',
    padding: '4px',
    margin: '8px 0',
  },
  '.cm-vis-bullet': { display: 'inline-block', minWidth: '1.5em', color: 'var(--muted)' },
});

/**
 * Overleaf-style visual mode: renders headings, emphasis, math, \input chips and list markers
 * over the unchanged source; markup reappears as raw text while a selection touches it.
 * ponytail: rebuilds the whole document on each change/selection; restrict to visible ranges
 * and map the rest if long documents lag.
 */
export function visualMode(opts: { openFile: (paths: string[]) => void }): Extension {
  const field = StateField.define<DecorationSet>({
    create: (state) => buildDecorations(state, opts.openFile),
    update(value, tr) {
      if (tr.docChanged || tr.selection || syntaxTree(tr.startState) !== syntaxTree(tr.state)) {
        return buildDecorations(tr.state, opts.openFile);
      }
      return value;
    },
    provide: (f) => EditorView.decorations.from(f),
  });
  return [field, EditorView.editorAttributes.of({ class: 'cm-visual' }), codeFont, theme];
}
