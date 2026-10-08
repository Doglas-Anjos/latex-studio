import { describe, expect, it } from 'vitest';
import { localLabels, usages } from './editor-references';

describe('usages', () => {
  it('finds \\ref and \\cite keys with kind and position, skipping comments', () => {
    const doc = 'see \\ref{sec:a} and \\cite{smith2020}\n% \\cite{commented}';
    const found = usages(doc);
    expect(found.map((u) => ({ kind: u.kind, key: u.key }))).toEqual([
      { kind: 'ref', key: 'sec:a' },
      { kind: 'cite', key: 'smith2020' },
    ]);
    // the key slice matches its reported range
    const ref = found[0];
    expect(ref && doc.slice(ref.from, ref.to)).toBe('sec:a');
  });

  it('splits a multi-key \\cite into separate keys with correct offsets', () => {
    const doc = '\\cite{a, b ,c}';
    const found = usages(doc);
    expect(found.map((u) => u.key)).toEqual(['a', 'b', 'c']);
    for (const u of found) expect(doc.slice(u.from, u.to)).toBe(u.key);
  });

  it('recognises natbib/cleveref variants and optional args', () => {
    const doc = '\\citep[p.~5]{k1} \\autoref{fig:x}';
    expect(usages(doc).map((u) => ({ kind: u.kind, key: u.key }))).toEqual([
      { kind: 'ref', key: 'fig:x' },
      { kind: 'cite', key: 'k1' },
    ]);
  });
});

describe('localLabels', () => {
  it('collects \\label keys from code only', () => {
    expect([...localLabels('\\label{a}\n% \\label{b}\n\\label{c}')]).toEqual(['a', 'c']);
  });
});
