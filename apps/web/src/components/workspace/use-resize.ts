import { type KeyboardEvent, type PointerEvent, type RefObject, useRef } from 'react';
import { type Settings, useSettingsStore } from '../../settings-store';

export type ResizeKey = 'sidebarWidth' | 'pdfWidth' | 'panelHeight';
const cssVar: Record<ResizeKey, string> = {
  sidebarWidth: '--sidebar-w',
  pdfWidth: '--pdf-w',
  panelHeight: '--panel-h',
};
const MIN: Record<ResizeKey, number> = { sidebarWidth: 160, pdfWidth: 240, panelHeight: 100 };
/** Dragging toward the editor grows the sidebar; for the pdf and the bottom panel it shrinks. */
const SIGN: Record<ResizeKey, 1 | -1> = { sidebarWidth: 1, pdfWidth: -1, panelHeight: -1 };

/** Drag/keyboard resize of a CSS variable on `root`; the final px lands in the settings store. */
export function useResize(root: RefObject<HTMLElement | null>, key: ResizeKey) {
  const drag = useRef<{ start: number; size: number; last: number } | null>(null);
  const vertical = key === 'panelHeight';
  const size = useSettingsStore((s) => s[key]);
  const set = useSettingsStore((s) => s.set);
  const apply = (px: number) => root.current?.style.setProperty(cssVar[key], `${px}px`);
  const clamp = (px: number) => Math.max(MIN[key], Math.round(px));
  const coord = (e: PointerEvent) => (vertical ? e.clientY : e.clientX);

  return {
    vertical,
    size,
    min: MIN[key],
    onPointerDown(e: PointerEvent<HTMLElement>) {
      e.currentTarget.setPointerCapture(e.pointerId);
      drag.current = { start: coord(e), size, last: size };
    },
    onPointerMove(e: PointerEvent<HTMLElement>) {
      const d = drag.current;
      if (!d) return;
      d.last = clamp(d.size + SIGN[key] * (coord(e) - d.start));
      apply(d.last);
    },
    onPointerUp(e: PointerEvent<HTMLElement>) {
      const d = drag.current;
      drag.current = null;
      e.currentTarget.releasePointerCapture?.(e.pointerId);
      if (d) set({ [key]: d.last } as Partial<Settings>);
    },
    onKeyDown(e: KeyboardEvent<HTMLElement>) {
      const dir = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[e.key];
      if (!dir) return;
      e.preventDefault();
      set({ [key]: clamp(size + SIGN[key] * dir * 16) } as Partial<Settings>);
    },
  };
}
