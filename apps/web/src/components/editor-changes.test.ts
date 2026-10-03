import { describe, expect, it } from 'vitest';
import { lineClasses } from './editor-changes';

describe('lineClasses', () => {
  it('marks modified, added and deleted lines', () => {
    // b changed, e appended
    const m = lineClasses('a\nb\nc\nd\n', 'a\nB\nc\nd\ne\n');
    expect(m.get(2)).toBe('modified');
    expect(m.get(5)).toBe('added');
    // removing "b" marks the following line
    expect(lineClasses('a\nb\nc\n', 'a\nc\n').get(2)).toBe('deleted');
  });
});
