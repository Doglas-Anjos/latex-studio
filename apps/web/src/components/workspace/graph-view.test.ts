import { expect, it } from 'vitest';
import { caption, seedPositions } from './graph-view';

it('fits whole words inside the circle, shrinking the font before cutting', () => {
  expect(caption('wind', 32, 11)).toEqual({ lines: ['wind'], size: 11 });
  expect(caption('pareto front', 32, 11)).toEqual({ lines: ['pareto', 'front'], size: 11 });
  // Splits after a hyphen, and shrinks until "dominated" fits whole.
  expect(caption('non-dominated', 24, 10)).toEqual({ lines: ['non-', 'dominated'], size: 7.5 });
  // Past the smallest font, it falls back to two cut lines.
  const long = caption('a very long subject name that never fits', 20, 10);
  expect(long.size).toBe(7);
  expect(long.lines).toHaveLength(2);
  expect(long.lines[1]?.endsWith('…')).toBe(true);
});

const node = (
  id: string,
  label: string,
  kind: 'root' | 'hub' | 'term',
): { id: string; label: string; kind: typeof kind; count: number; x?: number; y?: number } => ({
  id,
  label,
  kind,
  count: 1,
});

it('keeps known nodes in place and starts a new term beside its area', () => {
  // "wind" was a plain term before; promoted to an area it keeps its place (identity = label).
  const nodes = [
    node('root', 'Tese', 'root'),
    node('h:wind', 'wind', 'hub'),
    node('t:energy', 'energy', 'term'),
    node('t:turbine', 'turbine', 'term'),
  ];
  const links = [
    { source: 'root', target: 'h:wind' },
    { source: 'h:wind', target: 't:energy' },
    { source: 'h:wind', target: 't:turbine' },
  ];
  const prev = new Map([
    ['root', { x: 0, y: 0 }],
    ['wind', { x: 200, y: 0 }],
    ['energy', { x: 240, y: 10 }],
  ]);

  expect(seedPositions(nodes, links, prev)).toBe(true);
  expect(nodes[1]).toMatchObject({ x: 200, y: 0 });
  expect(nodes[2]).toMatchObject({ x: 240, y: 10 });
  const fresh = nodes[3];
  expect(Math.hypot((fresh?.x ?? 0) - 200, fresh?.y ?? 0)).toBeCloseTo(40);
});

it('reports a cold start when there is no previous layout', () => {
  expect(seedPositions([node('root', 'Tese', 'root')], [], new Map())).toBe(false);
});
