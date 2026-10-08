import { syntaxTree } from '@codemirror/language';
import {
  type EditorState,
  type Extension,
  type Range,
  StateEffect,
  StateField,
} from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  EditorView,
  showTooltip,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from '@codemirror/view';
import { MATH_NODES } from './latex-commands';

type Node = ReturnType<ReturnType<typeof syntaxTree>['resolveInner']>;
type Dialog = 'formula' | 'table';

/** What Ctrl/Cmd+hover turns into a button. A 'ref' only shows the hint: editor-references jumps. */
export interface Helper {
  kind: Dialog | 'file' | 'image' | 'ref';
  from: number;
  to: number;
  /** Where the caret goes before the helper opens (inside the node, so the dialog finds it). */
  caret: number;
  /** Files to try, first existing wins (\input adds .tex, \includegraphics an image extension). */
  paths: string[];
}

const LABEL: Record<Helper['kind'], string> = {
  table: '✎ Editar tabela',
  formula: '✎ Editar fórmula',
  file: '↗ Abrir arquivo',
  image: '↗ Abrir imagem',
  ref: '↗ Ir para a definição',
};
// pdflatex's own search order, so Ctrl+click opens the file LaTeX actually uses.
const IMAGE_EXT = ['.pdf', '.png', '.jpg', '.jpeg', '.eps'];
// Cmd on a Mac (Ctrl+click is the context menu there), Ctrl elsewhere.
const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent);
const MOD_KEY = MAC ? 'Meta' : 'Control';
const mod = (e: MouseEvent | KeyboardEvent) => (MAC ? e.metaKey : e.ctrlKey);

/** Files LaTeX reads for \input{arg} / \includegraphics{arg}: no `./`, extension added if absent. */
export function inputPaths(arg: string, image: boolean): string[] {
  const p = arg.trim().replace(/^(?:\.\/)+/, '');
  if (/\.[^/\\]+$/.test(p)) return [p];
  return image ? IMAGE_EXT.map((e) => p + e) : [`${p}.tex`];
}

/** A plain tabular the table helper can rewrite: not tabularx/longtable, no nested environment. */
function editableTabular(state: EditorState, n: { from: number; to: number }): boolean {
  const text = state.sliceDoc(n.from, n.to);
  return text.startsWith('\\begin{tabular}') && !text.includes('\\begin{', 1);
}

/** The innermost helper at `pos`, looking first on the side the pointer is (`assoc`). */
export function helperAt(state: EditorState, pos: number, assoc: -1 | 1 = 1): Helper | null {
  const tree = syntaxTree(state);
  for (const side of [assoc, -assoc as -1 | 1]) {
    for (let n: Node | null = tree.resolveInner(pos, side); n; n = n.parent) {
      const { name, from, to } = n;
      if (name === 'Ref' || name === 'Cite')
        return { kind: 'ref', from, to, caret: from, paths: [] };
      if (name === 'Input' || name === 'Include' || name === 'IncludeGraphics') {
        const p = /\{([^{}]*)\}\s*$/.exec(state.sliceDoc(from, to))?.[1]?.trim();
        // A half-typed `\includegraphics{}` must not hide the table around it.
        if (p) {
          const image = name === 'IncludeGraphics';
          return {
            kind: image ? 'image' : 'file',
            from,
            to,
            caret: from,
            paths: inputPaths(p, image),
          };
        }
        continue;
      }
      // Strictly inside: at its first character the dialog could pick a formula just before it.
      if (MATH_NODES.has(name)) return { kind: 'formula', from, to, caret: from + 1, paths: [] };
      if (name === 'TabularEnvironment' && editableTabular(state, n)) {
        const caret = n.getChild('BeginEnv')?.to ?? from;
        return { kind: 'table', from, to, caret, paths: [] };
      }
    }
  }
  return null;
}

const setHelper = StateEffect.define<Helper | null>();
const editing = (h: Helper | null) => h?.kind === 'table' || h?.kind === 'formula';

const helperField = StateField.define<Helper | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setHelper)) return e.value;
    return tr.docChanged ? null : value;
  },
  provide: (f) => [
    EditorView.decorations.from(f, (h) =>
      h
        ? Decoration.set(Decoration.mark({ class: 'cm-helper-target' }).range(h.from, h.to))
        : Decoration.none,
    ),
    showTooltip.from(f, (h) =>
      h
        ? {
            pos: h.from,
            above: true,
            create: () => {
              const dom = document.createElement('div');
              dom.className = 'cm-helper-tip';
              dom.textContent = `${LABEL[h.kind]} · ${MAC ? '⌘' : 'Ctrl'}+clique`;
              return { dom };
            },
          }
        : null,
    ),
  ],
});

/** "Editar tabela" after `\begin{tabular}{…}`: puts the caret in the table and opens the helper. */
class EditTableWidget extends WidgetType {
  constructor(private readonly onEdit: () => void) {
    super();
  }
  override toDOM(view: EditorView) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'cm-table-edit';
    b.textContent = '✎ Editar tabela';
    b.setAttribute('aria-label', 'Editar tabela');
    b.title = 'Abrir esta tabela no gerador de tabelas (ou Ctrl+clique na tabela)';
    b.addEventListener('click', () => {
      // A file can turn read-only (deleted, role change) after the button was drawn.
      if (view.state.readOnly) return;
      view.dispatch({ selection: { anchor: view.posAtDOM(b) } });
      this.onEdit();
    });
    return b;
  }
}

function tableButtons(view: EditorView, widget: Decoration): DecorationSet {
  if (view.state.readOnly) return Decoration.none;
  const at = new Set<number>();
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter: (n) => {
        if (n.name !== 'TabularEnvironment' || !editableTabular(view.state, n)) return;
        const begin = n.node.getChild('BeginEnv');
        if (begin) at.add(begin.to);
      },
    });
  }
  const out: Range<Decoration>[] = [...at].map((pos) => widget.range(pos));
  return Decoration.set(out, true);
}

/**
 * Helpers over the text: a permanent "Editar tabela" button per editable tabular, and Ctrl/Cmd
 * +hover, which outlines a table, formula, \input, \includegraphics or \ref/\cite as a button
 * that Ctrl/Cmd+click opens (dialogs and files here; references jump in editor-references).
 */
export function editorHelpers(opts: {
  openDialog: (d: Dialog) => void;
  openFile: (paths: string[]) => void;
}): Extension {
  const widget = Decoration.widget({
    widget: new EditTableWidget(() => opts.openDialog('table')),
    side: 1,
  });
  const buttons = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = tableButtons(view, widget);
      }
      update(u: ViewUpdate) {
        if (
          u.docChanged ||
          u.viewportChanged ||
          u.startState.readOnly !== u.state.readOnly ||
          syntaxTree(u.startState) !== syntaxTree(u.state)
        )
          this.decorations = tableButtons(u.view, widget);
      }
    },
    { decorations: (p) => p.decorations },
  );

  const target = (view: EditorView, x: number, y: number) => {
    const p = view.posAndSideAtCoords({ x, y });
    const h = p ? helperAt(view.state, p.pos, p.assoc) : null;
    // Viewers and reviewers still open files and follow references, but edit nothing.
    return editing(h) && view.state.readOnly ? null : h;
  };
  const hover = ViewPlugin.fromClass(
    class {
      x = 0;
      y = 0;
      inside = false;
      // Ctrl released while the editor is not focused never reaches its keyup handler.
      readonly up = (e: KeyboardEvent) => {
        if (e.key === MOD_KEY) this.show(false);
      };
      constructor(readonly view: EditorView) {
        view.dom.ownerDocument.addEventListener('keyup', this.up);
      }
      destroy() {
        this.view.dom.ownerDocument.removeEventListener('keyup', this.up);
      }
      show(mod: boolean) {
        const h = mod && this.inside ? target(this.view, this.x, this.y) : null;
        const cur = this.view.state.field(helperField);
        if (cur?.from === h?.from && cur?.to === h?.to && cur?.kind === h?.kind) return;
        this.view.dispatch({ effects: setHelper.of(h) });
      }
    },
    {
      eventHandlers: {
        mousemove(e) {
          this.x = e.clientX;
          this.y = e.clientY;
          this.inside = true;
          this.show(mod(e));
        },
        mouseleave() {
          this.inside = false;
          this.show(false);
        },
        keydown(e) {
          if (e.key === MOD_KEY) this.show(true);
        },
        blur() {
          this.show(false);
        },
        mousedown(e, view) {
          if (!mod(e) || e.button !== 0) return false;
          const h = target(view, e.clientX, e.clientY);
          if (!h) return false;
          // A ref that editor-references (registered earlier) did not jump from: no stray cursor.
          e.preventDefault();
          if (h.kind === 'ref') return true;
          if (h.kind === 'file' || h.kind === 'image') {
            view.dispatch({ effects: setHelper.of(null) });
            opts.openFile(h.paths);
          } else {
            view.dispatch({ selection: { anchor: h.caret }, effects: setHelper.of(null) });
            opts.openDialog(h.kind);
          }
          return true;
        },
      },
    },
  );

  return [
    helperField,
    buttons,
    hover,
    EditorView.baseTheme({
      '.cm-table-edit': {
        marginLeft: '0.75em',
        padding: '0 0.5em',
        border: '1px solid var(--line)',
        borderRadius: '6px',
        background: 'var(--surface)',
        color: 'var(--primary)',
        font: 'inherit',
        fontFamily: 'var(--font-ui)',
        fontSize: '0.8em',
        cursor: 'pointer',
      },
      '.cm-table-edit:hover': { background: 'var(--paper)' },
      '.cm-helper-target': {
        background: 'color-mix(in srgb, var(--primary) 12%, transparent)',
        outline: '1px solid color-mix(in srgb, var(--primary) 55%, transparent)',
        borderRadius: '3px',
        cursor: 'pointer',
      },
      '.cm-tooltip.cm-helper-tip': {
        padding: '2px 8px',
        border: 'none',
        borderRadius: '6px',
        background: 'var(--primary)',
        color: 'var(--primary-ink)',
        fontFamily: 'var(--font-ui)',
        fontSize: '0.8em',
      },
    }),
  ];
}
