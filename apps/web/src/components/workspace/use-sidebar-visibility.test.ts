// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSidebarVisibility } from './use-sidebar-visibility';

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

describe('useSidebarVisibility', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('starts open on desktop and closed on mobile', () => {
    fakeMatchMedia(true);
    expect(
      renderHook(() => useSidebarVisibility('(min-width: 56.0625rem)')).result.current.open,
    ).toBe(true);
    fakeMatchMedia(false);
    expect(
      renderHook(() => useSidebarVisibility('(min-width: 56.0625rem)')).result.current.open,
    ).toBe(false);
  });

  it('auto-collapses on the transition from desktop to mobile', () => {
    const mql = fakeMatchMedia(true);
    const { result } = renderHook(() => useSidebarVisibility('(min-width: 56.0625rem)'));
    expect(result.current.open).toBe(true);
    act(() => mql.change(false));
    expect(result.current.open).toBe(false);
  });

  it('keeps an explicit reopen on mobile until the next size change', () => {
    const mql = fakeMatchMedia(true);
    const { result } = renderHook(() => useSidebarVisibility('(min-width: 56.0625rem)'));
    act(() => mql.change(false));
    expect(result.current.open).toBe(false);
    act(() => result.current.setOpen(true));
    expect(result.current.open).toBe(true);
  });

  it('reopens automatically when growing back to desktop', () => {
    const mql = fakeMatchMedia(true);
    const { result } = renderHook(() => useSidebarVisibility('(min-width: 56.0625rem)'));
    act(() => mql.change(false));
    act(() => result.current.setOpen(true));
    act(() => mql.change(true));
    expect(result.current.open).toBe(true);
  });
});
