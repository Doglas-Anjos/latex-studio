import type { RefObject } from 'react';
import { type ResizeKey, useResize } from './use-resize';

export function Splitter({
  root,
  resizes,
  label,
}: {
  root: RefObject<HTMLElement | null>;
  resizes: ResizeKey;
  label: string;
}) {
  const { vertical, ...handlers } = useResize(root, resizes);
  return (
    // biome-ignore lint/a11y/useSemanticElements: a focusable separator is the WAI-ARIA window splitter pattern
    <div
      className="splitter"
      role="separator"
      aria-orientation={vertical ? 'horizontal' : 'vertical'}
      aria-label={label}
      aria-valuenow={0}
      tabIndex={0}
      {...handlers}
    />
  );
}
