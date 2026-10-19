import {
  type EditorState,
  Facet,
  type Range,
  RangeSet,
  RangeValue,
  StateEffect,
  StateField,
  type Transaction,
  type TransactionSpec,
} from '@codemirror/state';
import type * as Y from 'yjs';

/** The part of EditorView used here (a plain object in tests). */
type ViewLike = { readonly state: EditorState; dispatch(spec: TransactionSpec): void };

/** Who last touched a line before any commit. The colour is derived from `id` where it is drawn. */
export interface LineAuthor {
  id: string;
  name: string;
}

/** Typing, deleting, drag-moving, undo/redo by this user: remote updates and formatting do not. */
export const isLocalEdit = (tr: Transaction) =>
  ['input', 'delete', 'move', 'undo', 'redo'].some((e) => tr.isUserEvent(e));

/** Reads the local user, so this editor attributes its own edits (a getter: /me may change). */
export const localAuthor = Facet.define<() => LineAuthor | null, (() => LineAuthor | null) | null>({
  combine: (values) => values[0] ?? null,
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

/**
 * Per-line last editor. One point mark at each attributed line's start, remapped through every edit
 * so attribution follows the text. Fed by this user's own edits and by `setLineAuthor` effects
 * (remote peers, and the seed of earlier sessions). The newest edit of a line wins.
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
    if (tr.docChanged && isLocalEdit(tr)) {
      const me = tr.state.facet(localAuthor)?.();
      if (me) tr.changes.iterChangedRanges((_fa, _ta, fromB, toB) => mark(fromB, toB, me));
    }
    if (byPos.size === 0) return set;
    const positions = [...byPos.keys()].sort((a, b) => a - b);
    const add: Range<AuthorMark>[] = [];
    for (const pos of positions) {
      const author = byPos.get(pos);
      if (author) add.push(new AuthorMark(author).range(pos));
    }
    return set.update({
      filterFrom: positions[0] ?? 0,
      filterTo: positions[positions.length - 1] ?? 0,
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

/**
 * The client whose clock advanced in a remote transaction, or null.
 * ponytail: a batched transaction (a reconnect replaying several peers) is credited to the first;
 * split the delta per struct if that misattribution ever matters.
 */
function advancedClient(tr: Y.Transaction): number | null {
  for (const [client, clock] of tr.afterState) {
    if ((tr.beforeState.get(client) ?? 0) < clock) return client;
  }
  return null;
}

/**
 * Attributes remote edits to their author live: on each remote Y.Text change, find the peer whose
 * clock advanced, take their identity from awareness, and mark each changed span separately, so a
 * multi-place edit marks only those lines. Display only: the server rebuilds the awareness user
 * from the token but not per client id, so an editor could claim another peer's client id; commits
 * and history take the author from the verified session, never from here.
 * ponytail: a delete-only remote edit advances no clock (Yjs records no deleter), so it stays
 * unattributed live; the commit still credits it. Send the deleter in awareness if that matters.
 */
export function trackRemoteAuthors(
  view: ViewLike,
  ytext: Y.Text,
  awareness:
    | { getStates(): Map<number, { user?: { id?: unknown; name?: unknown } }> }
    | null
    | undefined,
): () => void {
  const observer = (event: Y.YTextEvent, tr: Y.Transaction) => {
    if (tr.local || !awareness) return;
    const client = advancedClient(tr);
    if (client == null) return;
    const author = toLineAuthor(awareness.getStates().get(client)?.user);
    if (!author) return;
    const effects: StateEffect<unknown>[] = [];
    let index = 0;
    for (const op of event.delta) {
      if (op.retain != null) index += op.retain;
      else if (op.insert != null) {
        const len = typeof op.insert === 'string' ? op.insert.length : 1;
        effects.push(setLineAuthor.of({ from: index, to: index + len, author }));
        index += len;
      } else if (op.delete != null) {
        effects.push(setLineAuthor.of({ from: index, to: index, author }));
      }
    }
    if (effects.length) queueMicrotask(() => view.dispatch({ effects }));
  };
  ytext.observe(observer);
  return () => ytext.unobserve(observer);
}

const AUTHORS = 'authors';

/**
 * A LineAuthor from untrusted data (the shared map, awareness), or null when malformed: any editor
 * can write the map, so one bad entry must not throw for everyone who opens the file.
 */
function toLineAuthor(v: unknown): LineAuthor | null {
  const e = v as { id?: unknown; userId?: unknown; name?: unknown } | null | undefined;
  const id = e?.userId ?? e?.id;
  if (typeof id !== 'string' || id.length === 0 || id.length > 64) return null;
  return { id, name: typeof e?.name === 'string' ? e.name.slice(0, 80) : '' };
}

/**
 * Record this client's identity in the doc's shared `authors` map (clientId → identity), so a later
 * session can attribute this client's unsaved edits. Call it on the first local edit only: a write
 * from a read-only connection is never acknowledged, and a write on open would count as an edit.
 * Stores the display name, never the e-mail (the map persists with the doc for every later reader).
 * ponytail: any editor can write any entry here (in FasorX too), so the gutter name is a hint that
 * git history does not depend on; tying clientIds to their connection server-side would close it.
 */
export function registerAuthor(doc: Y.Doc, id: string, name: string): void {
  const map = doc.getMap<{ userId: string; name: string }>(AUTHORS);
  const key = String(doc.clientID);
  const cur = map.get(key);
  if (cur?.userId === id && cur.name === name) return;
  map.set(key, { userId: id, name });
}

interface YItem {
  deleted: boolean;
  countable: boolean;
  length: number;
  id: { client: number };
  right: YItem | null;
}
/** The client that wrote the char at each of `offsets` (ascending), walking the Yjs items once. */
function clientsAt(ytext: Y.Text, offsets: number[]): Map<number, number> {
  const out = new Map<number, number>();
  // Yjs item linked list (internal, stable in 13.x): each countable, non-deleted item covers
  // `length` chars written by one client, in document order — so it aligns with the text.
  let item = (ytext as unknown as { _start: YItem | null })._start;
  let index = 0;
  let i = 0;
  while (item && i < offsets.length) {
    if (!item.deleted && item.countable) {
      const end = index + item.length;
      while (i < offsets.length && (offsets[i] as number) < end) {
        out.set(offsets[i] as number, item.id.client);
        i++;
      }
      index = end;
    }
    item = item.right;
  }
  return out;
}

/**
 * Re-attributes the uncommitted lines (`changed`, 1-based line numbers that differ from the saved
 * version) from who wrote their last character, resolved through the shared `authors` map, and
 * clears every other line, so a save or an edit typed back to the saved text drops its live mark
 * and the git blame shows again.
 */
export function seedPastAuthors(
  view: ViewLike,
  ytext: Y.Text,
  doc: Y.Doc,
  changed: ReadonlySet<number>,
): void {
  const authors = new Map<number, LineAuthor>();
  doc.getMap(AUTHORS).forEach((v, k) => {
    const a = toLineAuthor(v);
    if (a) authors.set(Number(k), a);
  });
  const text = view.state.doc;
  const lines = [...changed]
    .filter((n) => n >= 1 && n <= text.lines)
    .sort((a, b) => a - b)
    .map((n) => text.line(n))
    .filter((l) => l.length > 0);
  const who = authors.size
    ? clientsAt(
        ytext,
        lines.map((l) => l.to - 1),
      )
    : new Map();
  const effects: StateEffect<unknown>[] = [
    setLineAuthor.of({ from: 0, to: text.length, author: null }),
  ];
  for (const l of lines) {
    const author = authors.get(who.get(l.to - 1) ?? -1);
    if (author) effects.push(setLineAuthor.of({ from: l.from, to: l.from, author }));
  }
  view.dispatch({ effects });
}
