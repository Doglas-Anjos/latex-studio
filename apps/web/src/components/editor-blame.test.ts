import { describe, expect, it } from 'vitest';
import { ageLabel, runStarts } from './editor-blame';

describe('ageLabel', () => {
  const now = new Date('2026-10-03T12:00:00Z');
  it.each([
    ['2026-10-03T11:59:30Z', 'agora'],
    ['2026-10-03T11:55:00Z', '5 min'],
    ['2026-10-03T09:00:00Z', '3 h'],
    ['2026-10-01T12:00:00Z', '2 d'],
    ['2026-09-12T12:00:00Z', '3 sem'],
    ['2026-06-03T12:00:00Z', '4 mês'],
    ['2024-09-03T12:00:00Z', '2 ano'],
  ])('%s -> %s', (date, label) => {
    expect(ageLabel(new Date(date), now)).toBe(label);
  });
});

describe('runStarts', () => {
  it('maps the first line of each run', () => {
    const starts = runStarts({
      commits: {},
      lines: [
        { from: 1, to: 3, sha: 'a' },
        { from: 4, to: 4, sha: null },
      ],
    });
    expect([...starts.keys()]).toEqual([1, 4]);
    expect(starts.get(4)?.sha).toBeNull();
  });
});
