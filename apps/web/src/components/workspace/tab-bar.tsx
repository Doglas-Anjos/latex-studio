import { FileDiff, X } from 'lucide-react';
import { type KeyboardEvent, type MouseEvent, useEffect, useRef, useState } from 'react';
import { type Tab, useWorkspaceStore } from '../../workspace-store';
import { FileTypeIcon } from '../file-tree';

export const basename = (p: string) => p.slice(p.lastIndexOf('/') + 1);

/** Tab ids cut off at each edge of the strip. */
type Hidden = { before: string[]; after: string[] };
const NONE: Hidden = { before: [], after: [] };

export function TabBar() {
  const tabs = useWorkspaceStore((s) => s.tabs);
  const activeTabId = useWorkspaceStore((s) => s.activeTabId);
  const closeTab = useWorkspaceStore((s) => s.closeTab);
  const openTab = useWorkspaceStore((s) => s.openTab);
  const stripRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());
  const [hidden, setHidden] = useState<Hidden>(NONE);
  const [menuOpen, setMenuOpen] = useState(false);
  const stackRef = useRef<HTMLDivElement>(null);

  // Which tabs are not fully visible, from layout the browser already has (offsetLeft/Width are
  // relative to the positioned strip); the state only changes when the sets do.
  useEffect(() => {
    const el = stripRef.current;
    if (!el) return;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const left = el.scrollLeft;
        const right = left + el.clientWidth;
        const next: Hidden = { before: [], after: [] };
        for (const t of tabs) {
          const node = tabRefs.current.get(t.id)?.parentElement;
          if (!node) continue;
          if (node.offsetLeft < left - 1) next.before.push(t.id);
          else if (node.offsetLeft + node.offsetWidth > right + 1) next.after.push(t.id);
        }
        setHidden((prev) =>
          prev.before.join() === next.before.join() && prev.after.join() === next.after.join()
            ? prev
            : next,
        );
      });
    };
    // A vertical wheel scrolls the strip sideways once it overflows; horizontal deltas (trackpads)
    // keep their native behaviour.
    const onWheel = (e: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    measure();
    el.addEventListener('scroll', measure, { passive: true });
    el.addEventListener('wheel', onWheel, { passive: false });
    // No ResizeObserver in jsdom: scroll-only tracking there is enough for the tests.
    const observer =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : undefined;
    observer?.observe(el);
    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener('scroll', measure);
      el.removeEventListener('wheel', onWheel);
      observer?.disconnect();
    };
  }, [tabs]);

  // The whole card, close button included: revealing only the label left the "x" cut off, and the
  // card then counted as hidden.
  const reveal = (id: string) =>
    tabRefs.current
      .get(id)
      ?.parentElement?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });

  // The stack takes the same room on either side, so the visible width only changes when overflow
  // starts or ends; that moment can cut the tab just opened, hence the second trigger.
  const overflowing = hidden.before.length > 0 || hidden.after.length > 0;

  // Keeps the active tab in view after opening it from the file tree or
  // restoring it from history, without yanking the whole page vertically.
  // biome-ignore lint/correctness/useExhaustiveDependencies: overflowing re-runs it when the stack appears.
  useEffect(() => {
    if (!activeTabId) return;
    reveal(activeTabId);
  }, [activeTabId, overflowing]);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: Event) => {
      if (!stackRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: globalThis.KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const activateNeighbour = (index: number) => {
    const next = tabs[index];
    if (!next) return;
    openTab(next);
    tabRefs.current.get(next.id)?.focus();
  };

  const onLabelKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      activateNeighbour((index + 1) % tabs.length);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      activateNeighbour((index - 1 + tabs.length) % tabs.length);
    } else if (e.key === 'Home') {
      e.preventDefault();
      activateNeighbour(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      activateNeighbour(tabs.length - 1);
    }
  };

  // Middle-click closes the tab (handled on auxclick below); preventing the
  // default on mousedown stops the browser's middle-click autoscroll cursor
  // from kicking in first.
  const onTabMouseDown = (e: MouseEvent<HTMLDivElement>) => {
    if (e.button === 1) e.preventDefault();
  };

  // The stack sits at the end while tabs are cut off there; scrolled all the way, it moves to the
  // start for the ones cut off on the left.
  const stackSide = hidden.after.length ? 'end' : hidden.before.length ? 'start' : null;
  const stackIds = stackSide === 'end' ? hidden.after : hidden.before;
  const stackTabs = tabs.filter((t) => stackIds.includes(t.id));
  const stack = stackSide && (
    <div className="tab-stack-wrap" ref={stackRef} data-side={stackSide}>
      <button
        type="button"
        className="tab-stack"
        aria-label={`${stackTabs.length} abas fora da vista`}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        title={stackTabs.map((t) => basename(t.path)).join(', ')}
        onClick={() => setMenuOpen((o) => !o)}
      >
        <span className="tab-stack-card">+{stackTabs.length}</span>
      </button>
      {menuOpen && (
        <div className="tab-stack-menu" role="menu" aria-label="Abas fora da vista">
          {stackTabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="menuitem"
              className="tab-stack-item"
              data-active={t.id === activeTabId}
              title={t.path}
              onClick={() => {
                setMenuOpen(false);
                openTab(t);
                reveal(t.id);
              }}
            >
              <TabIcon tab={t} />
              <span className="tab-label-text">{basename(t.path)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div className="tab-bar">
      {stackSide === 'start' && stack}
      <div
        className="tab-strip"
        ref={stripRef}
        role="tablist"
        aria-label="Arquivos abertos"
        data-fade-start={hidden.before.length > 0}
        data-fade-end={hidden.after.length > 0}
      >
        {tabs.map((t, i) => {
          const name = basename(t.path);
          const active = t.id === activeTabId;
          return (
            // biome-ignore lint/a11y/noStaticElementInteractions: middle-click close/autoscroll guard; the tab and close button inside are the real interactive/focusable targets.
            <div
              key={t.id}
              className="tab"
              data-active={active}
              onMouseDown={onTabMouseDown}
              onAuxClick={(e) => {
                if (e.button === 1) closeTab(t.id);
              }}
            >
              <button
                ref={(el) => {
                  if (el) tabRefs.current.set(t.id, el);
                  else tabRefs.current.delete(t.id);
                }}
                type="button"
                role="tab"
                aria-selected={active}
                tabIndex={active ? 0 : -1}
                title={t.kind === 'diff' ? `${t.path} (diff)` : t.path}
                className="tab-label"
                onClick={() => openTab(t)}
                onKeyDown={(e) => onLabelKeyDown(e, i)}
              >
                <TabIcon tab={t} />
                <span className="tab-label-text">{name}</span>
              </button>
              <button
                type="button"
                className="tab-close"
                aria-label={`Fechar ${name}`}
                onClick={() => closeTab(t.id)}
              >
                <X size={14} aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>
      {stackSide === 'end' && stack}
    </div>
  );
}

function TabIcon({ tab }: { tab: Tab }) {
  if (tab.kind === 'diff') {
    return <FileDiff size={14} className="file-icon file-icon-diff" aria-hidden="true" />;
  }
  return <FileTypeIcon name={tab.path} />;
}
