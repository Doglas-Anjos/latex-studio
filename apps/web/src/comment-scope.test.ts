import { describe, expect, it } from 'vitest';
import {
  lineRangeAt,
  scopeEmptyReason,
  scopeRange,
  sectionRangeAt,
  wordRangeAt,
} from './comment-scope';

describe('wordRangeAt', () => {
  it('expands to both sides of the cursor', () => {
    expect(wordRangeAt('hello world', 2)).toEqual({ from: 0, to: 5 });
  });

  it('includes a leading backslash so LaTeX commands count as one word', () => {
    const text = 'a \\section b';
    expect(wordRangeAt(text, 4)).toEqual({ from: 2, to: 10 });
  });

  it('is touched by the word on the left when the cursor sits right after it', () => {
    expect(wordRangeAt('foo bar', 3)).toEqual({ from: 0, to: 3 });
  });

  it('returns null when the cursor touches no word', () => {
    expect(wordRangeAt('foo   bar', 5)).toBeNull();
  });

  it('returns null on an empty string', () => {
    expect(wordRangeAt('', 0)).toBeNull();
  });

  it('matches accented letters as word characters', () => {
    expect(wordRangeAt('café quente', 1)).toEqual({ from: 0, to: 4 });
  });
});

describe('lineRangeAt', () => {
  const text = 'first\nsecond\nthird';

  it('returns the single line at a collapsed cursor', () => {
    const pos = text.indexOf('second') + 2;
    expect(lineRangeAt(text, pos, pos)).toEqual({ from: 6, to: 12 });
  });

  it('expands to the first and last line of a multi-line selection', () => {
    const from = text.indexOf('first') + 2;
    const to = text.indexOf('third') + 2;
    expect(lineRangeAt(text, from, to)).toEqual({ from: 0, to: 18 });
  });

  it('covers the first line when the cursor is at the very start', () => {
    expect(lineRangeAt(text, 0, 0)).toEqual({ from: 0, to: 5 });
  });

  it('covers the last line when the cursor is at the very end', () => {
    expect(lineRangeAt(text, text.length, text.length)).toEqual({ from: 13, to: 18 });
  });

  it('leaves out a line the selection only reaches the start of', () => {
    // [0, 6) selects "first\n": the exclusive end sits on "second" but nothing
    // of that line is selected.
    expect(lineRangeAt(text, 0, 6)).toEqual({ from: 0, to: 5 });
  });

  it('leaves out the next line after a multi-line selection too', () => {
    expect(lineRangeAt(text, 0, text.indexOf('third'))).toEqual({ from: 0, to: 12 });
  });

  it('includes the last line as soon as the selection reaches into it', () => {
    expect(lineRangeAt(text, 0, 7)).toEqual({ from: 0, to: 12 });
  });

  it('still returns the line a collapsed cursor sits at the start of', () => {
    expect(lineRangeAt(text, 6, 6)).toEqual({ from: 6, to: 12 });
  });

  it('excludes the carriage return of a CRLF break', () => {
    const crlf = 'first\r\nsecond';
    expect(lineRangeAt(crlf, 2, 2)).toEqual({ from: 0, to: 5 });
    expect(lineRangeAt(crlf, 0, 7)).toEqual({ from: 0, to: 5 });
    expect(lineRangeAt(crlf, 7, 7)).toEqual({ from: 7, to: crlf.length });
  });
});

describe('sectionRangeAt', () => {
  it('returns the whole file when there are no section commands', () => {
    const text = 'Just a paragraph, no headings.';
    expect(sectionRangeAt(text, 5)).toEqual({ from: 0, to: text.length });
  });

  it('returns null for an empty file', () => {
    expect(sectionRangeAt('', 0)).toBeNull();
  });

  it('covers content before the first section as a section-less range', () => {
    const text = 'preamble text\n\\section{Intro}\nbody';
    const pos = text.indexOf('preamble') + 3;
    expect(sectionRangeAt(text, pos)).toEqual({ from: 0, to: text.indexOf('\\section') });
  });

  it('stops a section at the next section of the same level', () => {
    const text = '\\section{A}\nfoo\n\\section{B}\nbar';
    const pos = text.indexOf('foo');
    expect(sectionRangeAt(text, pos)).toEqual({ from: 0, to: text.indexOf('\\section{B}') });
  });

  it('a subsection is closed by the next section, not just the next subsection', () => {
    const text = '\\section{A}\n\\subsection{A.1}\nfoo\n\\section{B}\nbar';
    const pos = text.indexOf('foo');
    expect(sectionRangeAt(text, pos)).toEqual({
      from: text.indexOf('\\subsection'),
      to: text.indexOf('\\section{B}'),
    });
  });

  it('a subsection is not closed by a deeper subsubsection', () => {
    const text = '\\subsection{A}\nfoo\n\\subsubsection{A.1}\nbar\n\\subsection{B}';
    const pos = text.indexOf('foo');
    expect(sectionRangeAt(text, pos)).toEqual({
      from: 0,
      to: text.indexOf('\\subsection{B}'),
    });
  });

  it('runs to the end of the file for the last section', () => {
    const text = '\\section{A}\nfoo\n\\section{B}\nbar';
    const pos = text.indexOf('bar');
    expect(sectionRangeAt(text, pos)).toEqual({
      from: text.indexOf('\\section{B}'),
      to: text.length,
    });
  });

  it('matches a starred section command', () => {
    const text = '\\section*{A}\nfoo\n\\section{B}';
    const pos = text.indexOf('foo');
    expect(sectionRangeAt(text, pos)).toEqual({ from: 0, to: text.indexOf('\\section{B}') });
  });

  it('does not confuse \\subsection with \\section', () => {
    const text = '\\subsection{A}\nfoo';
    const pos = text.indexOf('foo');
    expect(sectionRangeAt(text, pos)).toEqual({ from: 0, to: text.length });
  });

  it('a chapter closes an open section', () => {
    const text = '\\chapter{One}\n\\section{A}\nfoo\n\\chapter{Two}';
    const pos = text.indexOf('foo');
    expect(sectionRangeAt(text, pos)).toEqual({
      from: text.indexOf('\\section'),
      to: text.indexOf('\\chapter{Two}'),
    });
  });

  it('ignores a section command on a commented-out line', () => {
    const text = 'intro\n% \\section{Fake}\nbody';
    expect(sectionRangeAt(text, text.indexOf('body'))).toEqual({ from: 0, to: text.length });
  });

  it('a commented-out section does not close the section above it', () => {
    const text = '\\section{A}\nfoo\n% \\section{B}\nbar';
    expect(sectionRangeAt(text, text.indexOf('bar'))).toEqual({ from: 0, to: text.length });
  });

  it('ignores a command inside a comment trailing a line of code', () => {
    const text = '\\section{A} % \\subsection{B}\nfoo';
    expect(sectionRangeAt(text, text.indexOf('foo'))).toEqual({ from: 0, to: text.length });
  });

  it('an escaped percent does not open a comment', () => {
    const text = '100\\% \\section{A}\nfoo';
    expect(sectionRangeAt(text, text.indexOf('foo'))).toEqual({
      from: text.indexOf('\\section'),
      to: text.length,
    });
  });

  it('does not read an escaped \\\\section as a section start', () => {
    const text = 'line\\\\section{A}\nfoo';
    expect(sectionRangeAt(text, text.indexOf('foo'))).toEqual({ from: 0, to: text.length });
  });

  it('finds a real section command that follows an escaped one', () => {
    const text = '\\\\section{not a section}\n\\section{Real}\nbody';
    expect(sectionRangeAt(text, text.indexOf('body'))).toEqual({
      from: text.lastIndexOf('\\section'),
      to: text.length,
    });
  });

  it('a line break right before a command still starts a section', () => {
    const text = 'x\\\\\\section{A}\nfoo';
    expect(sectionRangeAt(text, text.indexOf('foo'))).toEqual({
      from: text.lastIndexOf('\\section'),
      to: text.length,
    });
  });

  it('accepts a star and spaces between the command and the brace', () => {
    const text = 'pre\n\\section * {A}\nfoo';
    expect(sectionRangeAt(text, text.indexOf('foo'))).toEqual({
      from: text.indexOf('\\section'),
      to: text.length,
    });
  });

  it('accepts a single line break before the brace', () => {
    const text = 'pre\n\\section\n{A}\nfoo';
    expect(sectionRangeAt(text, text.indexOf('foo'))).toEqual({
      from: text.indexOf('\\section'),
      to: text.length,
    });
  });

  it('does not join a bare command to a brace a blank line below', () => {
    const text = 'pre \\section\n\n{A}\nfoo';
    expect(sectionRangeAt(text, text.indexOf('foo'))).toEqual({ from: 0, to: text.length });
  });
});

describe('scopeRange', () => {
  const text = 'alpha beta\ngamma';

  it('selection scope is null without a real selection', () => {
    expect(scopeRange({ text, from: 3, to: 3, head: 3 }, 'selection')).toBeNull();
  });

  it('selection scope returns the selection bounds', () => {
    expect(scopeRange({ text, from: 0, to: 5, head: 5 }, 'selection')).toEqual({ from: 0, to: 5 });
  });

  it('word scope uses the cursor head, not the selection', () => {
    expect(scopeRange({ text, from: 0, to: 5, head: 7 }, 'word')).toEqual({ from: 6, to: 10 });
  });

  it('line scope uses the selection bounds', () => {
    expect(scopeRange({ text, from: 0, to: 0, head: 0 }, 'line')).toEqual({ from: 0, to: 10 });
  });

  it('line scope keeps the selection end exclusive', () => {
    expect(scopeRange({ text, from: 0, to: 11, head: 11 }, 'line')).toEqual({ from: 0, to: 10 });
  });

  it('section scope uses the cursor head', () => {
    expect(scopeRange({ text: '\\section{A}\nfoo', from: 0, to: 0, head: 13 }, 'section')).toEqual({
      from: 0,
      to: 15,
    });
  });
});

describe('scopeEmptyReason', () => {
  it('has a distinct message per scope', () => {
    const reasons = (['selection', 'word', 'line', 'section'] as const).map(scopeEmptyReason);
    expect(new Set(reasons).size).toBe(4);
  });
});
