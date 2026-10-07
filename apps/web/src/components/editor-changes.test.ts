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

  // cap_03: a long chapter full of identical `% ────` separator lines, with "work" -> "study" on a
  // few far-apart lines. MergeView's default scanLimit (500) gave up there and marked ~200 lines
  // as a single changed block.
  it('keeps small far-apart edits in a long chapter as separate lines', () => {
    const vocabulary =
      'forecast wind series horizon model error metric attention layer pareto front weight operator reserve energy capacity variance noise trend season'.split(
        ' ',
      );
    const paragraph = (i: number) => {
      let s = `Paragraph ${i}:`;
      for (let k = i * 31; s.length < 100 + (i % 5) * 150; k += 7) {
        s += ` ${vocabulary[k % vocabulary.length]}${k % 13}`;
      }
      return `${s} of this work.`;
    };
    const lines = Array.from({ length: 600 }, (_, i) =>
      i % 3 === 2
        ? ''
        : i % 7 === 0
          ? `% ${'─'.repeat(60)}`
          : i % 11 === 0
            ? `% ${'='.repeat(60)}`
            : paragraph(i),
    );
    lines[10] = `Paragraph of this work ${lines[10]}`;
    lines[133] = `${paragraph(133)} with \\acrshort{pv} panels`;
    const edited = lines.map((l, i) =>
      [10, 76, 202, 490, 566].includes(i)
        ? l.replaceAll('this work', 'this study')
        : i === 133
          ? l.replace('acrshort', 'acrfull')
          : l,
    );
    const changed = edited.flatMap((l, i) => (l !== lines[i] ? [i + 1] : []));
    expect(changed.length).toBeGreaterThan(2);
    const m = lineClasses(lines.join('\n'), edited.join('\n'));
    expect([...m.keys()]).toEqual(changed);
  });
});
