import { type RefObject, useCallback, useEffect, useRef, useState } from 'react';

export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 4;
export const ZOOM_STEP = 0.1;
export const ZOOM_DEFAULT = 1;

export function clampZoom(value: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value));
}

/** Multiplicative zoom change for one wheel tick; negative deltaY (scroll up) zooms in. */
export function zoomFactorFromDelta(deltaY: number): number {
  return Math.exp(-deltaY * 0.0015);
}

/** New scroll offset keeping the content under `origin` fixed while the container scales by `ratio`. */
export function scrollForZoom(scrollPos: number, origin: number, ratio: number): number {
  return (scrollPos + origin) * ratio - origin;
}

export type ZoomApi = {
  zoom: number;
  zoomIn: () => void;
  zoomOut: () => void;
  reset: () => void;
};

/**
 * Ctrl/Cmd+wheel zoom around the cursor for a scrollable container (also how
 * trackpads report pinch). The listener is native, not React's passive
 * onWheel, so preventDefault actually suppresses the browser's own page zoom
 * for the ctrl gesture — plain wheel scrolling never reaches this handler.
 */
export function useZoom(containerRef: RefObject<HTMLElement | null>): ZoomApi {
  const [zoom, setZoomState] = useState(ZOOM_DEFAULT);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  const applyZoom = useCallback(
    (next: number, origin?: { x: number; y: number }) => {
      const clamped = clampZoom(next);
      const prev = zoomRef.current;
      if (clamped === prev) return;
      const el = containerRef.current;
      if (!el) {
        setZoomState(clamped);
        return;
      }
      const rect = el.getBoundingClientRect();
      const ratio = clamped / prev;
      const originX = origin ? origin.x - rect.left : el.clientWidth / 2;
      const originY = origin ? origin.y - rect.top : el.clientHeight / 2;
      const scrollLeft = scrollForZoom(el.scrollLeft, originX, ratio);
      const scrollTop = scrollForZoom(el.scrollTop, originY, ratio);
      setZoomState(clamped);
      requestAnimationFrame(() => {
        el.scrollLeft = scrollLeft;
        el.scrollTop = scrollTop;
      });
    },
    [containerRef],
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      applyZoom(zoomRef.current * zoomFactorFromDelta(e.deltaY), { x: e.clientX, y: e.clientY });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [containerRef, applyZoom]);

  const zoomIn = useCallback(() => applyZoom(zoomRef.current + ZOOM_STEP), [applyZoom]);
  const zoomOut = useCallback(() => applyZoom(zoomRef.current - ZOOM_STEP), [applyZoom]);
  const reset = useCallback(() => applyZoom(ZOOM_DEFAULT), [applyZoom]);

  return { zoom, zoomIn, zoomOut, reset };
}
