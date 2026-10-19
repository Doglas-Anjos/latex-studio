import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { authorAt, lineAuthorsField, localAuthor, setLineAuthor } from './editor-authors';

const me = { id: 'u1', name: 'Me', color: '#111111' };
const bob = { id: 'u2', name: 'Bob', color: '#222222' };

const make = (doc: string) =>
  EditorState.create({ doc, extensions: [localAuthor.of(me), lineAuthorsField] });

describe('lineAuthorsField', () => {
  it('attributes a local user edit to the local user, only on the edited line', () => {
    let s = make('aaa\nbbb\nccc');
    s = s.update({ changes: { from: 8, insert: 'X' }, userEvent: 'input.type' }).state; // line 3
    const set = s.field(lineAuthorsField);
    expect(authorAt(set, s.doc.line(3).from)?.id).toBe('u1');
    expect(authorAt(set, s.doc.line(1).from)).toBeNull();
    expect(authorAt(set, s.doc.line(2).from)).toBeNull();
  });

  it('attributes a remote edit via the effect, and the newest edit of a line wins', () => {
    let s = make('aaa\nbbb\nccc');
    const l2 = s.doc.line(2);
    s = s.update({ effects: setLineAuthor.of({ from: l2.from, to: l2.to, author: bob }) }).state;
    expect(authorAt(s.field(lineAuthorsField), s.doc.line(2).from)?.id).toBe('u2');
    s = s.update({
      changes: { from: s.doc.line(2).from, insert: 'Z' },
      userEvent: 'input.type',
    }).state;
    expect(authorAt(s.field(lineAuthorsField), s.doc.line(2).from)?.id).toBe('u1');
  });

  it('follows the text when earlier lines shift it down', () => {
    let s = make('aaa\nbbb\nccc');
    s = s.update({ changes: { from: 8, insert: 'X' }, userEvent: 'input.type' }).state; // line 3 -> me
    s = s.update({ changes: { from: 4, insert: 'mid\n' } }).state; // programmatic insert above it
    // The originally-edited line is now line 4; the attribution moved with it.
    expect(authorAt(s.field(lineAuthorsField), s.doc.line(4).from)?.id).toBe('u1');
  });

  it('ignores programmatic (non-user) edits with no author', () => {
    let s = make('a');
    s = s.update({ changes: { from: 1, insert: 'b' } }).state; // no userEvent
    expect(authorAt(s.field(lineAuthorsField), s.doc.line(1).from)).toBeNull();
  });

  it('clears a line when attributed to null', () => {
    let s = make('aaa');
    s = s.update({ changes: { from: 0, insert: 'X' }, userEvent: 'input.type' }).state;
    expect(authorAt(s.field(lineAuthorsField), 0)?.id).toBe('u1');
    s = s.update({ effects: setLineAuthor.of({ from: 0, to: 0, author: null }) }).state;
    expect(authorAt(s.field(lineAuthorsField), 0)).toBeNull();
  });
});
