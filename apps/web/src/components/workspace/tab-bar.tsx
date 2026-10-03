import { X } from 'lucide-react';
import { useWorkspaceStore } from '../../workspace-store';

const basename = (p: string) => p.slice(p.lastIndexOf('/') + 1);

export function TabBar() {
  const tabs = useWorkspaceStore((s) => s.tabs);
  const activeTabId = useWorkspaceStore((s) => s.activeTabId);
  const closeTab = useWorkspaceStore((s) => s.closeTab);
  const openTab = useWorkspaceStore((s) => s.openTab);
  return (
    <div className="tab-bar" role="tablist" aria-label="Arquivos abertos">
      {tabs.map((t) => {
        const name = t.kind === 'diff' ? `${basename(t.path)} (diff)` : basename(t.path);
        return (
          <div
            key={t.id}
            className="tab"
            data-active={t.id === activeTabId}
            onAuxClick={(e) => {
              if (e.button === 1) closeTab(t.id);
            }}
          >
            <button
              type="button"
              role="tab"
              aria-selected={t.id === activeTabId}
              title={t.path}
              className="tab-label"
              onClick={() => openTab(t)}
            >
              {name}
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
  );
}
