import { useEffect, useRef, useState } from 'react';
import { useMatchMedia } from './use-match-media';

/**
 * Sidebar starts open on desktop and collapsed on mobile, read from the same
 * synchronous initial match as `wideEnough` so there's no open-then-collapse
 * flash on mount. Growing past the breakpoint always reopens it (the toggle
 * to do so manually disappears on desktop). Shrinking below it auto-collapses
 * too, but only on that transition: once on mobile, an explicit reopen
 * gesture sticks until the next size change.
 */
export function useSidebarVisibility(query: string) {
  const wideEnough = useMatchMedia(query);
  const [open, setOpen] = useState(wideEnough);
  const wasWideEnough = useRef(wideEnough);
  useEffect(() => {
    if (wideEnough) setOpen(true);
    else if (wasWideEnough.current) setOpen(false);
    wasWideEnough.current = wideEnough;
  }, [wideEnough]);
  return { wideEnough, open, setOpen };
}
