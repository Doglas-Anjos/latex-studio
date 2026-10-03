import { expect, it } from 'vitest';
import { findMainFile } from './main-file';

it('prefers main.tex, else first tex with documentclass, else null', () => {
  const doc = '\\documentclass{article}';
  expect(
    findMainFile([
      ['a.tex', doc],
      ['main.tex', doc],
    ]),
  ).toBe('main.tex');
  expect(
    findMainFile([
      ['ch.tex', 'text'],
      ['b.tex', doc],
      ['c.tex', doc],
    ]),
  ).toBe('b.tex');
  expect(
    findMainFile([
      ['a.tex', `% ${doc}`],
      ['main.tex', 'x'],
    ]),
  ).toBeNull();
});
