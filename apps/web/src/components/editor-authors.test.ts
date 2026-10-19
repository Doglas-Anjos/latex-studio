import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { authorAt, lineAuthorsField, setAuthors } from './editor-authors';

const me = { id: 'u1', name: 'Me', color: '#111111' };
const bob = { id: 'u2', name: 'Bob', color: '#222222' };

const make = (doc: string) => EditorState.create({ doc, extensions: [lineAuthorsField] });

describe('lineAuthorsField', () => {
  it('sets per-line authors and reads them back by line start', () => {
    let s = make('aaa\nbbb\nccc');
    const l2 = s.doc.line(2).from;
    const l3 = s.doc.line(3).from;
    s = s.update({
      effects: setAuthors.of([
        { pos: l2, author: bob },
        { pos: l3, author: me },
      ]),
    }).state;
    const set = s.field(lineAuthorsField);
    expect(authorAt(set, l2)?.id).toBe('u2');
    expect(authorAt(set, l3)?.id).toBe('u1');
    expect(authorAt(set, s.doc.line(1).from)).toBeNull();
  });

  it('replaces the whole set on each setAuthors (a committed line is cleared)', () => {
    let s = make('aaa\nbbb');
    s = s.update({ effects: setAuthors.of([{ pos: 0, author: bob }]) }).state;
    s = s.update({ effects: setAuthors.of([{ pos: s.doc.line(2).from, author: me }]) }).state;
    expect(authorAt(s.field(lineAuthorsField), 0)).toBeNull();
    expect(authorAt(s.field(lineAuthorsField), s.doc.line(2).from)?.id).toBe('u1');
  });

  it('follows the text through edits made between recomputes', () => {
    let s = make('aaa\nbbb\nccc');
    s = s.update({ effects: setAuthors.of([{ pos: s.doc.line(3).from, author: me }]) }).state;
    s = s.update({ changes: { from: 4, insert: 'mid\n' } }).state; // pushes line 3 down to line 4
    expect(authorAt(s.field(lineAuthorsField), s.doc.line(4).from)?.id).toBe('u1');
  });
});
