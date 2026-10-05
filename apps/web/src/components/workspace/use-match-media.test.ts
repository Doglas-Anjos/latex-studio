// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useMatchMedia } from './use-match-media';

function fakeMatchMedia(initial: boolean) {
  let matches = initial;
  let listener: (() => void) | null = null;
  const mql = {
    get matches() {
      return matches;
    },
    addEventListener: (_: string, fn: () => void) => {
      listener = fn;
    },
    removeEventListener: vi.fn(),
  };
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue(mql));
  return {
    change: (next: boolean) => {
      matches = next;
      listener?.();
    },
  };
}

describe('useMatchMedia', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('reflects the initial match and updates on change', () => {
    const mql = fakeMatchMedia(false);
    const { result } = renderHook(() => useMatchMedia('(max-width: 75rem)'));
    expect(result.current).toBe(false);
    act(() => mql.change(true));
    expect(result.current).toBe(true);
  });
});
