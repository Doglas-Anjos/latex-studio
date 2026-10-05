// @vitest-environment jsdom
import { act, fireEvent, renderHook } from '@testing-library/react';
import type { RefObject } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  clampZoom,
  scrollForZoom,
  useZoom,
  ZOOM_DEFAULT,
  ZOOM_MAX,
  ZOOM_MIN,
  zoomFactorFromDelta,
} from './use-zoom';

describe('clampZoom', () => {
  it('clamps to [ZOOM_MIN, ZOOM_MAX]', () => {
    expect(clampZoom(0)).toBe(ZOOM_MIN);
    expect(clampZoom(100)).toBe(ZOOM_MAX);
    expect(clampZoom(1.5)).toBe(1.5);
  });
});

describe('zoomFactorFromDelta', () => {
  it('zooms in for scroll-up (negative deltaY) and out for scroll-down', () => {
    expect(zoomFactorFromDelta(-100)).toBeGreaterThan(1);
    expect(zoomFactorFromDelta(100)).toBeLessThan(1);
    expect(zoomFactorFromDelta(0)).toBe(1);
  });
});

describe('scrollForZoom', () => {
  it('keeps the point under origin fixed when the container scales by ratio', () => {
    // scrollPos=100 + origin=40 locates the content point at 140 (pre-zoom); doubling
    // the scale moves that point to 280, so scroll must grow to 280 - 40 = 240 to keep
    // it under the same viewport position.
    expect(scrollForZoom(100, 40, 2)).toBe(240);
    expect(scrollForZoom(0, 0, 2)).toBe(0);
  });
});

function makeContainerRef(): RefObject<HTMLElement | null> {
  const el = document.createElement('div');
  document.body.append(el);
  return { current: el };
}

describe('useZoom', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it('starts at the default zoom', () => {
    const { result } = renderHook(() => useZoom(makeContainerRef()));
    expect(result.current.zoom).toBe(ZOOM_DEFAULT);
  });

  it('ctrl+wheel zooms in/out around the cursor and prevents the browser page zoom', () => {
    const ref = makeContainerRef();
    const { result } = renderHook(() => useZoom(ref));

    let notPrevented = true;
    act(() => {
      notPrevented = fireEvent.wheel(ref.current as HTMLElement, { deltaY: -100, ctrlKey: true });
    });
    expect(notPrevented).toBe(false);
    expect(result.current.zoom).toBeGreaterThan(ZOOM_DEFAULT);

    const zoomedIn = result.current.zoom;
    act(() => {
      fireEvent.wheel(ref.current as HTMLElement, { deltaY: 100, ctrlKey: true });
    });
    expect(result.current.zoom).toBeLessThan(zoomedIn);
  });

  it('leaves plain wheel scrolling untouched', () => {
    const ref = makeContainerRef();
    const { result } = renderHook(() => useZoom(ref));

    let notPrevented = false;
    act(() => {
      notPrevented = fireEvent.wheel(ref.current as HTMLElement, { deltaY: -100, ctrlKey: false });
    });
    expect(notPrevented).toBe(true);
    expect(result.current.zoom).toBe(ZOOM_DEFAULT);
  });

  it('zoomIn/zoomOut step and clamp at the configured bounds', () => {
    const { result } = renderHook(() => useZoom(makeContainerRef()));

    // Each call needs its own act() so the ref-cached zoom value picks up the
    // previous step's re-render before computing the next one.
    for (let i = 0; i < 40; i++) act(() => result.current.zoomIn());
    expect(result.current.zoom).toBe(ZOOM_MAX);

    for (let i = 0; i < 40; i++) act(() => result.current.zoomOut());
    expect(result.current.zoom).toBe(ZOOM_MIN);
  });

  it('reset returns to the default zoom', () => {
    const { result } = renderHook(() => useZoom(makeContainerRef()));
    act(() => result.current.zoomIn());
    expect(result.current.zoom).not.toBe(ZOOM_DEFAULT);
    act(() => result.current.reset());
    expect(result.current.zoom).toBe(ZOOM_DEFAULT);
  });
});
