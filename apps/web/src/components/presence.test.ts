// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { peerColor, peerSlot } from './presence';

describe('peerColor', () => {
  it('is stable and inside the palette', () => {
    expect(peerColor('user-1')).toBe(peerColor('user-1'));
    for (const id of ['a', 'b', 'user-1', 'user-2', '']) {
      expect(peerSlot(id)).toBeGreaterThanOrEqual(0);
      expect(peerSlot(id)).toBeLessThan(8);
      expect(peerColor(id)).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});
