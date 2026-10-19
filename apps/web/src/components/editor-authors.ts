import { type Extension, RangeSet, RangeValue, StateEffect, StateField } from '@codemirror/state';
import { type EditorView, ViewPlugin } from '@codemirror/view';
import type * as Y from 'yjs';
import { lineClasses } from './editor-changes';

/** Who last touched a line (uncommitted): the identity, so it has a stable colour. */
export interface LineAuthor {
  id: string;
  name: string;
  color: string;
}

/** Replaces the whole per-line authorship set (recomputed by the source plugin on each change). */
export const setAuthors = StateEffect.define<{ pos: number; author: LineAuthor }[]>();

class AuthorMark extends RangeValue {
  constructor(readonly author: LineAuthor) {
    super();
  }
  override eq(other: RangeValue) {
    return other instanceof AuthorMark && other.author.id === this.author.id;
  }
}

/**
 * Per-line last editor of the uncommitted lines. A point mark at each line's start, remapped through
 * edits so it tracks the text between recomputes, and replaced wholesale when `setAuthors` arrives.
 */
export const lineAuthorsField = StateField.define<RangeSet<AuthorMark>>({
  create: () => RangeSet.empty,
  update(set, tr) {
    set = set.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setAuthors)) {
        set = RangeSet.of(
          e.value.map(({ pos, author }) => new AuthorMark(author).range(pos)),
          true,
        );
      }
    }
    return set;
  },
});

/** The live author of the line starting at `pos`, or null. */
export function authorAt(set: RangeSet<AuthorMark>, pos: number): LineAuthor | null {
  let out: LineAuthor | null = null;
  set.between(pos, pos, (_f, _t, v) => {
    out = v.author;
    return false;
  });
  return out;
}

const AUTHORS = 'authors';
type AuthorEntry = { userId: string; name: string };

/**
 * Record this client's identity in the doc's shared `authors` map (clientId → identity). It syncs to
 * peers and persists with the document, so a later session can still attribute this client's edits.
 * ponytail: a client could write a fake name here (trusted-LAN feature); the server could overwrite
 * each entry from the authenticated identity if that ever needs enforcing.
 */
export function registerAuthor(doc: Y.Doc, me: LineAuthor): void {
  doc.getMap<AuthorEntry>(AUTHORS).set(String(doc.clientID), { userId: me.id, name: me.name });
}

/** clientId → the char positions it wrote: a per-char client array aligned with the text. */
function clientsPerChar(ytext: Y.Text): number[] {
  const perChar: number[] = [];
  // Yjs item linked list (internal, stable in 13.x): each countable, non-deleted item covers
  // `length` chars written by one client, in document order — so it aligns with the text.
  let item = (ytext as unknown as { _start: YItem | null })._start;
  while (item) {
    if (!item.deleted && item.countable) {
      for (let i = 0; i < item.length; i++) perChar.push(item.id.client);
    }
    item = item.right;
  }
  return perChar;
}
interface YItem {
  deleted: boolean;
  countable: boolean;
  length: number;
  id: { client: number };
  right: YItem | null;
}

/**
 * Feeds `lineAuthorsField`: the live author of each line that differs from the committed base, from
 * the Yjs items (who wrote each char) resolved through the shared `authors` map. Committed lines are
 * left to the git blame gutter. Debounced, and re-run when the text, the base or the map changes.
 */
export function authorshipSource(opts: {
  doc: Y.Doc;
  ytext: Y.Text;
  color: (userId: string) => string;
  base: { current: string | null };
}): Extension {
  const { doc, ytext, color, base } = opts;
  return ViewPlugin.fromClass(
    class {
      timer: ReturnType<typeof setTimeout> | undefined;
      onMap = () => this.schedule();
      constructor(readonly view: EditorView) {
        doc.getMap(AUTHORS).observe(this.onMap);
        this.schedule();
      }
      update(u: { docChanged: boolean; transactions: readonly { effects: readonly unknown[] }[] }) {
        if (u.docChanged) this.schedule();
      }
      schedule() {
        clearTimeout(this.timer);
        this.timer = setTimeout(() => this.recompute(), 300);
      }
      recompute() {
        const authors = new Map<number, LineAuthor>();
        doc.getMap<AuthorEntry>(AUTHORS).forEach((v, k) => {
          if (v?.userId)
            authors.set(Number(k), { id: v.userId, name: v.name ?? '', color: color(v.userId) });
        });
        const text = this.view.state.doc;
        // Only lines that differ from the committed version get a live author; the rest keep git blame.
        const changed = base.current === null ? null : lineClasses(base.current, text.toString());
        const perChar = authors.size ? clientsPerChar(ytext) : [];
        const out: { pos: number; author: LineAuthor }[] = [];
        for (let n = 1; n <= text.lines; n++) {
          if (changed && !changed.has(n)) continue;
          const line = text.line(n);
          if (line.length === 0) continue;
          const author = authors.get(perChar[line.to - 1] ?? -1);
          if (author) out.push({ pos: line.from, author });
        }
        this.view.dispatch({ effects: setAuthors.of(out) });
      }
      destroy() {
        clearTimeout(this.timer);
        doc.getMap(AUTHORS).unobserve(this.onMap);
      }
    },
  );
}
