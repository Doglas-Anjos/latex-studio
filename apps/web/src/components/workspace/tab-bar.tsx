import { ChevronLeft, ChevronRight, FileDiff, X } from 'lucide-react';
import { type KeyboardEvent, type MouseEvent, useEffect, useRef, useState } from 'react';
import { type Tab, useWorkspaceStore } from '../../workspace-store';
import { FileTypeIcon } from '../file-tree';

const basename = (p: string) => p.slice(p.lastIndexOf('/') + 1);

export function TabBar() {
  const tabs = useWorkspaceStore((s) => s.tabs);
  const activeTabId = useWorkspaceStore((s) => s.activeTabId);
  const closeTab = useWorkspaceStore((s) => s.closeTab);
  const openTab = useWorkspaceStore((s) => s.openTab);
  const stripRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());
  const [overflow, setOverflow] = useState({ start: false, end: false });

  const updateOverflow = () => {
    const el = stripRef.current;
    if (!el) return;
    setOverflow({
      start: el.scrollLeft > 1,
      end: el.scrollLeft + el.clientWidth < el.scrollWidth - 1,
    });
  };

  // No ResizeObserver in jsdom: fall back to scroll-only tracking there, the
  // pixel geometry doesn't matter for the tests that mount this.
  // biome-ignore lint/correctness/useExhaustiveDependencies: tabs.length re-measures after tabs are added/removed, not read in the body.
  useEffect(() => {
    const el = stripRef.current;
    if (!el) return;
    updateOverflow();
    el.addEventListener('scroll', updateOverflow);
    const observer =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(updateOverflow) : undefined;
    observer?.observe(el);
    return () => {
      el.removeEventListener('scroll', updateOverflow);
      observer?.disconnect();
    };
  }, [tabs.length]);

  // Keeps the active tab in view after opening it from the file tree or
  // restoring it from history, without yanking the whole page vertically.
  useEffect(() => {
    if (!activeTabId) return;
    tabRefs.current.get(activeTabId)?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [activeTabId]);

  const scrollByStep = (dir: 1 | -1) => {
    stripRef.current?.scrollBy({ left: dir * 160, behavior: 'smooth' });
  };

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

  return (
    <div className="tab-bar">
      {overflow.start && (
        <button
          type="button"
          className="tab-scroll-btn"
          aria-label="Abas anteriores"
          onClick={() => scrollByStep(-1)}
        >
          <ChevronLeft size={14} aria-hidden="true" />
        </button>
      )}
      <div
        className="tab-strip"
        ref={stripRef}
        role="tablist"
        aria-label="Arquivos abertos"
        data-fade-start={overflow.start}
        data-fade-end={overflow.end}
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
      {overflow.end && (
        <button
          type="button"
          className="tab-scroll-btn"
          aria-label="Próximas abas"
          onClick={() => scrollByStep(1)}
        >
          <ChevronRight size={14} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

function TabIcon({ tab }: { tab: Tab }) {
  if (tab.kind === 'diff') {
    return <FileDiff size={14} className="file-icon file-icon-diff" aria-hidden="true" />;
  }
  return <FileTypeIcon name={tab.path} />;
}
