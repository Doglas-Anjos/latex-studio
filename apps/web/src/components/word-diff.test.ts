import { describe, expect, it } from 'vitest';
import { wordDiff } from './word-diff';

const changes = (a: string, b: string) =>
  wordDiff(a, b).flatMap((p) => (p.type === 'change' ? [[p.removed, p.added]] : []));

describe('wordDiff', () => {
  it('reports whole words, not characters', () => {
    expect(changes('the gap addressed by this work.', 'the gap addressed by this study.')).toEqual([
      ['work', 'study'],
    ]);
  });

  it('ignores re-wrapping a paragraph but not splitting it', () => {
    const a = 'This chapter surveys relevant\nworks and identifies the gap.';
    expect(changes(a, 'This chapter surveys\nrelevant works and identifies the gap.')).toEqual([]);
    expect(changes(a, 'This chapter surveys relevant\n\nworks and identifies the gap.')).toEqual([
      ['\n', '\n\n'],
    ]);
  });

  it('rebuilds the new text and maps offsets back to both texts', () => {
    const a = 'Transformers forecast wind power well.';
    const b = 'Transformers predict wind energy well, mostly.';
    const parts = wordDiff(a, b);
    expect(parts.map((p) => (p.type === 'same' ? p.text : p.added)).join('')).toBe(b);
    for (const p of parts) {
      if (p.type !== 'change') continue;
      expect(a.slice(p.fromA, p.toA)).toBe(p.removed);
      expect(b.slice(p.fromB, p.toB)).toBe(p.added);
    }
  });
});
