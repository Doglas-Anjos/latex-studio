import { describe, expect, it } from 'vitest';
import { findBibEntries, findBibItems, findLabels } from './reference-index';

describe('findLabels', () => {
  it('collects labels with 1-based line numbers, ignoring comments', () => {
    const src = [
      '\\section{A}\\label{sec:a}',
      '% \\label{commented}',
      'text \\label{eq:b} more',
    ].join('\n');
    expect(findLabels(src)).toEqual([
      { key: 'sec:a', line: 1 },
      { key: 'eq:b', line: 3 },
    ]);
  });
});

describe('findBibItems', () => {
  it('collects \\bibitem keys including the optional label form', () => {
    const src = ['\\bibitem{smith2020}', '\\bibitem[Jones]{jones1999}'].join('\n');
    expect(findBibItems(src)).toEqual([
      { key: 'smith2020', line: 1 },
      { key: 'jones1999', line: 2 },
    ]);
  });
});

describe('findBibEntries', () => {
  it('collects @type keys and skips @string/@comment', () => {
    const src = [
      '@string{ieee = "IEEE"}',
      '@article{vaswani2017,',
      '  title = {Attention},',
      '}',
      '@book{ goodfellow2016 , title={DL} }',
    ].join('\n');
    expect(findBibEntries(src)).toEqual([
      { key: 'vaswani2017', line: 2 },
      { key: 'goodfellow2016', line: 5 },
    ]);
  });
});
