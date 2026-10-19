import { EditorState, type TransactionSpec } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  authorAt,
  lineAuthorsField,
  localAuthor,
  registerAuthor,
  seedPastAuthors,
  setLineAuthor,
  trackRemoteAuthors,
} from './editor-authors';

const me = { id: 'u1', name: 'Me' };
const bob = { id: 'u2', name: 'Bob' };

const make = (doc: string) =>
  EditorState.create({ doc, extensions: [localAuthor.of(() => me), lineAuthorsField] });

/** A stand-in for EditorView: just `state` and `dispatch`. */
const fakeView = (doc: string) => {
  let state = make(doc);
  return {
    get state() {
      return state;
    },
    set state(s: EditorState) {
      state = s;
    },
    dispatch: (spec: TransactionSpec) => {
      state = state.update(spec).state;
    },
  };
};
const authorOfLine = (state: EditorState, n: number) =>
  authorAt(state.field(lineAuthorsField), state.doc.line(n).from)?.id ?? null;

/** Two peers that see each other's updates. */
const pair = (text: string) => {
  const a = new Y.Doc();
  const b = new Y.Doc();
  a.getText('content').insert(0, text);
  const sync = () => {
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
  };
  sync();
  return { a, b, sync };
};

describe('lineAuthorsField', () => {
  it('attributes a local user edit to the local user, only on the edited line', () => {
    let s = make('aaa\nbbb\nccc');
    s = s.update({ changes: { from: 8, insert: 'X' }, userEvent: 'input.type' }).state; // line 3
    expect(authorOfLine(s, 3)).toBe('u1');
    expect(authorOfLine(s, 1)).toBeNull();
  });

  it('ignores programmatic and remote edits (no userEvent)', () => {
    let s = make('a');
    s = s.update({ changes: { from: 1, insert: 'b' } }).state;
    expect(authorOfLine(s, 1)).toBeNull();
  });

  it('lets the newest edit of a line win, and follows the text as lines shift', () => {
    let s = make('aaa\nbbb\nccc');
    const l2 = s.doc.line(2);
    s = s.update({ effects: setLineAuthor.of({ from: l2.from, to: l2.to, author: bob }) }).state;
    expect(authorOfLine(s, 2)).toBe('u2');
    s = s.update({ changes: { from: l2.from, insert: 'Z' }, userEvent: 'input.type' }).state;
    expect(authorOfLine(s, 2)).toBe('u1');
    s = s.update({ changes: { from: 0, insert: 'top\n' } }).state;
    expect(authorOfLine(s, 3)).toBe('u1');
  });
});

describe('seedPastAuthors', () => {
  it('credits each changed line to whoever wrote its last character, and clears the rest', () => {
    const { a, b, sync } = pair('aaa\nbbb\nccc');
    const yb = b.getText('content');
    yb.insert(7, 'X'); // Bob appends to line 2
    registerAuthor(a, 'id-a', 'Ana');
    registerAuthor(b, 'id-b', 'Bob');
    sync();
    const ya = a.getText('content');
    const view = fakeView(ya.toString());
    view.dispatch({ effects: setLineAuthor.of({ from: 0, to: 0, author: me }) }); // a stale mark
    seedPastAuthors(view, ya, a, new Set([2]));
    expect(authorOfLine(view.state, 2)).toBe('id-b');
    expect(authorOfLine(view.state, 1)).toBeNull(); // not changed: the stale mark is gone
  });

  it('survives a malformed entry any editor could write to the shared map', () => {
    const { a } = pair('aaa');
    a.getMap('authors').set('1', { userId: 1 });
    a.getMap('authors').set(String(a.clientID), { userId: { x: 1 }, name: 5 });
    const view = fakeView('aaa');
    expect(() => seedPastAuthors(view, a.getText('content'), a, new Set([1]))).not.toThrow();
    expect(authorOfLine(view.state, 1)).toBeNull();
  });

  it('registers once: a repeat with the same identity does not write the map again', () => {
    const { a } = pair('aaa');
    let writes = 0;
    a.getMap('authors').observe(() => writes++);
    registerAuthor(a, 'id-a', 'Ana');
    registerAuthor(a, 'id-a', 'Ana');
    expect(writes).toBe(1);
  });
});

describe('trackRemoteAuthors', () => {
  it('marks only the lines a remote edit touched, not everything in between', async () => {
    const { a, b } = pair('aaa\nbbb\nccc\nddd');
    const ya = a.getText('content');
    const yb = b.getText('content');
    const view = fakeView(ya.toString());
    const awareness = { getStates: () => new Map([[b.clientID, { user: bob }]]) };
    const stop = trackRemoteAuthors(view, ya, awareness);
    b.transact(() => {
      yb.insert(3, 'X'); // end of line 1
      yb.insert(yb.length, 'Y'); // end of line 4
    });
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    view.state = make(ya.toString()); // what y-codemirror would have applied
    await Promise.resolve();
    expect(authorOfLine(view.state, 1)).toBe('u2');
    expect(authorOfLine(view.state, 4)).toBe('u2');
    expect(authorOfLine(view.state, 2)).toBeNull();
    expect(authorOfLine(view.state, 3)).toBeNull();
    stop();
  });
});
