// Usage (editor.tsx): const base = { current: null as string | null };
//   extensions: [..., changeGutter(base)]; when the baseline text arrives:
//   view.dispatch({ effects: setChangeBase.of(text) })  (null clears the markers).
import { Chunk } from '@codemirror/merge';
import { type Extension, StateEffect, StateField, Text } from '@codemirror/state';
import { type EditorView, GutterMarker, gutter, ViewPlugin } from '@codemirror/view';
// Function-level import only (both used inside lineMarker); the modules form a benign cycle.
import { authorAt, lineAuthorsField } from './editor-authors';

type LineClass = 'added' | 'modified' | 'deleted';
/**
 * Keeps a huge rewrite from freezing the tab; the diff degrades instead. The timeout is the real
 * guard (a full 60 KB rewrite takes ~330 ms at this scanLimit). MergeView's default scanLimit of
 * 500 gave up on a long chapter with a few one-word edits and repeated `% ───` separator lines,
 * reporting ~200 lines as one changed block.
 */
export const DIFF_LIMITS = { scanLimit: 5000, timeout: 500 };

export const setChangeBase = StateEffect.define<string | null>();
const setLineClasses = StateEffect.define<Map<number, LineClass>>();

/** Line number (1-based, in `current`) -> change class, relative to `base`. */
export function lineClasses(base: string, current: string): Map<number, LineClass> {
  const a = Text.of(base.split('\n'));
  const b = Text.of(current.split('\n'));
  const out = new Map<number, LineClass>();
  for (const c of Chunk.build(a, b, DIFF_LIMITS)) {
    if (c.fromB === c.toB) {
      out.set(Math.min(b.lineAt(c.fromB).number, b.lines), 'deleted');
      continue;
    }
    const cls = c.fromA === c.toA ? 'added' : 'modified';
    for (let n = b.lineAt(c.fromB).number; n <= b.lineAt(c.endB).number; n++) out.set(n, cls);
  }
  return out;
}

const classField = StateField.define<Map<number, LineClass>>({
  create: () => new Map(),
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setLineClasses)) return e.value;
    return value;
  },
});

const markers = {
  added: new (class extends GutterMarker {
    override elementClass = 'cm-line-added';
  })(),
  modified: new (class extends GutterMarker {
    override elementClass = 'cm-line-modified';
  })(),
  deleted: new (class extends GutterMarker {
    override elementClass = 'cm-line-deleted';
  })(),
};

// An added/modified bar tinted with the line's author colour (so you see who changed it even with
// the blame gutter off); falls back to the semantic added/modified colour when the author is unknown.
class AuthorBar extends GutterMarker {
  constructor(
    readonly cls: 'added' | 'modified',
    readonly color: string,
  ) {
    super();
  }
  override eq(other: GutterMarker) {
    return other instanceof AuthorBar && other.cls === this.cls && other.color === this.color;
  }
  override toDOM() {
    const el = document.createElement('span');
    el.className = `cm-line-${this.cls} cm-line-authored`;
    el.style.setProperty('--author-color', this.color);
    return el;
  }
}

export function changeGutter(base: { current: string | null }): Extension {
  const plugin = ViewPlugin.fromClass(
    class {
      timer: ReturnType<typeof setTimeout> | undefined;
      constructor(readonly view: EditorView) {
        this.schedule();
      }
      update(u: {
        docChanged: boolean;
        transactions: readonly { effects: readonly StateEffect<unknown>[] }[];
      }) {
        for (const tr of u.transactions)
          for (const e of tr.effects) if (e.is(setChangeBase)) base.current = e.value;
        const baseChanged = u.transactions.some((tr) =>
          tr.effects.some((e) => e.is(setChangeBase)),
        );
        if (u.docChanged || baseChanged) this.schedule();
      }
      schedule() {
        clearTimeout(this.timer);
        this.timer = setTimeout(() => {
          const map =
            base.current === null
              ? new Map<number, LineClass>()
              : lineClasses(base.current, this.view.state.doc.toString());
          this.view.dispatch({ effects: setLineClasses.of(map) });
        }, 300);
      }
      destroy() {
        clearTimeout(this.timer);
      }
    },
  );
  return [
    classField,
    plugin,
    gutter({
      class: 'cm-changes-gutter',
      lineMarker(view, line) {
        const cls = view.state.field(classField).get(view.state.doc.lineAt(line.from).number);
        if (!cls) return null;
        if (cls === 'deleted') return markers.deleted;
        const authors = view.state.field(lineAuthorsField, false);
        const author = authors ? authorAt(authors, line.from) : null;
        return author?.color ? new AuthorBar(cls, author.color) : markers[cls];
      },
      lineMarkerChange: (u) =>
        u.startState.field(lineAuthorsField, false) !== u.state.field(lineAuthorsField, false) ||
        u.transactions.some((t) => t.effects.some((e) => e.is(setLineClasses))),
    }),
  ];
}
