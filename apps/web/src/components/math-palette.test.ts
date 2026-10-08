import katex from 'katex';
import { describe, expect, it } from 'vitest';
import { MATH_PALETTE } from './math-palette';

describe('MATH_PALETTE', () => {
  it('has unique category ids', () => {
    const ids = MATH_PALETTE.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('renders every item in KaTeX and gives it a title', () => {
    for (const { items } of MATH_PALETTE) {
      for (const item of items) {
        expect(
          () => katex.renderToString(item.tex, { throwOnError: true }),
          item.tex,
        ).not.toThrow();
        expect(item.title).not.toBe('');
      }
    }
  });
});
