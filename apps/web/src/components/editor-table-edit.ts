import { syntaxTree } from '@codemirror/language';
import type { Range } from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from '@codemirror/view';

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
    b.title = 'Abrir esta tabela no gerador de tabelas';
    b.addEventListener('click', () => {
      // A file can turn read-only (deleted, role change) after the button was drawn.
      if (view.state.readOnly) return;
      view.dispatch({ selection: { anchor: view.posAtDOM(b) } });
      this.onEdit();
    });
    return b;
  }
}

function build(view: EditorView, widget: Decoration): DecorationSet {
  const at = new Set<number>();
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter: (n) => {
        if (n.name !== 'TabularEnvironment') return;
        const begin = n.node.getChild('BeginEnv');
        // Only what the helper can rewrite: plain tabular (not tabularx/longtable), and no
        // environment nested in a cell (a multi-line cell's inner tabular would be mis-split).
        const text = view.state.sliceDoc(n.from, n.to);
        if (begin && text.startsWith('\\begin{tabular}') && !text.includes('\\begin{', 1))
          at.add(begin.to);
      },
    });
  }
  const out: Range<Decoration>[] = [...at].map((pos) => widget.range(pos));
  return Decoration.set(out, true);
}

/** One "Editar tabela" button per visible tabular (code and visual modes). */
export function tableEditButtons(onEdit: () => void) {
  const widget = Decoration.widget({ widget: new EditTableWidget(onEdit), side: 1 });
  return [
    ViewPlugin.fromClass(
      class {
        decorations: DecorationSet;
        constructor(view: EditorView) {
          this.decorations = build(view, widget);
        }
        update(u: ViewUpdate) {
          if (u.docChanged || u.viewportChanged || syntaxTree(u.startState) !== syntaxTree(u.state))
            this.decorations = build(u.view, widget);
        }
      },
      { decorations: (p) => p.decorations },
    ),
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
    }),
  ];
}
