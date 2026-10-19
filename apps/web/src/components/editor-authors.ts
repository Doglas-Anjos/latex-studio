import {
  Facet,
  type Range,
  RangeSet,
  RangeValue,
  StateEffect,
  StateField,
  Transaction,
} from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import type * as Y from 'yjs';
// Function-level import only (used inside seedPastAuthors); the modules form a benign cycle.
import { lineClasses } from './editor-changes';

/** Who last touched a line, live (before any commit): the identity, so it has a stable colour. */
export interface LineAuthor {
  id: string;
  name: string;
  color: string;
}

/** The local user, so this editor can attribute its own edits; null until /me is known. */
export const localAuthor = Facet.define<LineAuthor | null, LineAuthor | null>({
  combine: (values) => values.find((v) => v) ?? null,
});

/** Attributes the lines spanning [from, to] to `author` (null clears them). */
export const setLineAuthor = StateEffect.define<{
  from: number;
  to: number;
  author: LineAuthor | null;
}>();

class AuthorMark extends RangeValue {
  constructor(readonly author: LineAuthor) {
    super();
  }
  override eq(other: RangeValue) {
    return other instanceof AuthorMark && other.author.id === this.author.id;
  }
}

// A local edit by this user (typing, pasting, deleting, dragging) — not a remote sync or a
// programmatic change, which carry no userEvent.
const LOCAL_EDIT = /^(input|delete|move)/;

/**
 * Per-line last editor. One point mark at each attributed line's start, remapped through every edit
 * so attribution follows the text. Fed by local user edits (this user, via userEvent) and by
 * `setLineAuthor` effects (remote peers and the past-session seed). The newest edit of a line wins.
 */
export const lineAuthorsField = StateField.define<RangeSet<AuthorMark>>({
  create: () => RangeSet.empty,
  update(set, tr) {
    set = set.map(tr.changes);
    const doc = tr.state.doc;
    const byPos = new Map<number, LineAuthor | null>();
    const mark = (from: number, to: number, author: LineAuthor | null) => {
      const a = Math.max(0, Math.min(from, doc.length));
      const b = Math.max(a, Math.min(to, doc.length));
      for (let ln = doc.lineAt(a).number; ln <= doc.lineAt(b).number; ln++) {
        byPos.set(doc.line(ln).from, author);
      }
    };
    for (const e of tr.effects)
      if (e.is(setLineAuthor)) mark(e.value.from, e.value.to, e.value.author);
    if (tr.docChanged) {
      const ue = tr.annotation(Transaction.userEvent);
      const me = ue && LOCAL_EDIT.test(ue) ? tr.state.facet(localAuthor) : null;
      if (me) tr.changes.iterChangedRanges((_fa, _ta, fromB, toB) => mark(fromB, toB, me));
    }
    if (byPos.size === 0) return set;
    const positions = [...byPos.keys()].sort((a, b) => a - b);
    const first = positions[0] ?? 0;
    const last = positions[positions.length - 1] ?? 0;
    const add: Range<AuthorMark>[] = [];
    for (const pos of positions) {
      const author = byPos.get(pos);
      if (author) add.push(new AuthorMark(author).range(pos));
    }
    return set.update({
      filterFrom: first,
      filterTo: last,
      filter: (from) => !byPos.has(from),
      add,
    });
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

/** The one client whose clock advanced in a (remote) transaction, or null. */
function advancedClient(tr: Y.Transaction): number | null {
  for (const [client, clock] of tr.afterState) {
    if ((tr.beforeState.get(client) ?? 0) < clock) return client;
  }
  return null;
}

/**
 * Attributes remote edits to their author live: on each remote Y.Text change, find the peer whose
 * clock advanced, map it to their awareness identity, and mark the changed span. Local edits are
 * handled by the field itself (via userEvent), so those are skipped here.
 */
export function trackRemoteAuthors(
  view: EditorView,
  ytext: Y.Text,
  awareness: { getStates(): Map<number, { user?: Partial<LineAuthor> }> } | null | undefined,
): () => void {
  const observer = (event: Y.YTextEvent, tr: Y.Transaction) => {
    if (tr.local || !awareness) return;
    const client = advancedClient(tr);
    if (client == null) return;
    const u = awareness.getStates().get(client)?.user;
    if (!u?.id) return;
    const author: LineAuthor = { id: u.id, name: u.name ?? '', color: u.color ?? '' };
    let index = 0;
    let from = -1;
    let to = 0;
    for (const op of event.delta) {
      if (op.retain != null) index += op.retain;
      else if (op.insert != null) {
        if (from < 0) from = index;
        index += typeof op.insert === 'string' ? op.insert.length : 1;
        to = index;
      } else if (op.delete != null) {
        if (from < 0) from = index;
        to = Math.max(to, index);
      }
    }
    if (from < 0) return;
    const span = { from, to: Math.max(to, from), author };
    queueMicrotask(() => view.dispatch({ effects: setLineAuthor.of(span) }));
  };
  ytext.observe(observer);
  return () => ytext.unobserve(observer);
}

const AUTHORS = 'authors';
type AuthorEntry = { userId: string; name: string };

/**
 * Record this client's identity in the doc's shared `authors` map (clientId → identity). It syncs to
 * peers and persists with the document, so a later session can attribute this client's past edits.
 * ponytail: a client could write a fake name here (trusted-LAN feature); the server could overwrite
 * each entry from the authenticated identity if that ever needs enforcing.
 */
export function registerAuthor(doc: Y.Doc, me: LineAuthor): void {
  doc.getMap<AuthorEntry>(AUTHORS).set(String(doc.clientID), { userId: me.id, name: me.name });
}

interface YItem {
  deleted: boolean;
  countable: boolean;
  length: number;
  id: { client: number };
  right: YItem | null;
}
/** A per-char client-id array aligned with the text (who wrote each character). */
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

/**
 * Attributes lines edited in earlier sessions (shown as "unsaved" with no live author yet): walks
 * the Yjs items for who wrote each char, resolved through the shared `authors` map, for the lines
 * that differ from the committed base. Only runs once the base is known, so committed lines keep the
 * git blame. Live edits are layered on top by the field itself and `trackRemoteAuthors`.
 */
export function seedPastAuthors(
  view: EditorView,
  ytext: Y.Text,
  doc: Y.Doc,
  color: (userId: string) => string,
  base: { current: string | null },
): void {
  if (base.current === null) return;
  const authors = new Map<number, LineAuthor>();
  doc.getMap<AuthorEntry>(AUTHORS).forEach((v, k) => {
    if (v?.userId)
      authors.set(Number(k), { id: v.userId, name: v.name ?? '', color: color(v.userId) });
  });
  if (authors.size === 0) return;
  const text = view.state.doc;
  const changed = lineClasses(base.current, text.toString());
  const perChar = clientsPerChar(ytext);
  const effects: StateEffect<unknown>[] = [];
  for (let n = 1; n <= text.lines; n++) {
    if (!changed.has(n)) continue;
    const line = text.line(n);
    if (line.length === 0) continue;
    const author = authors.get(perChar[line.to - 1] ?? -1);
    if (author) effects.push(setLineAuthor.of({ from: line.from, to: line.from, author }));
  }
  if (effects.length) view.dispatch({ effects });
}
