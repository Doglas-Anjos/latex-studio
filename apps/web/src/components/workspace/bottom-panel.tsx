import { PanelBottomClose, PanelBottomOpen } from 'lucide-react';
import { useSettingsStore } from '../../settings-store';
import { BuildPanel } from '../build-panel';

export function BottomPanel({ projectId, canCompile }: { projectId: string; canCompile: boolean }) {
  const open = useSettingsStore((s) => s.panelOpen);
  const set = useSettingsStore((s) => s.set);
  const Icon = open ? PanelBottomClose : PanelBottomOpen;
  const label = open ? 'Recolher painel' : 'Abrir painel';
  return (
    <div className="bottom-panel" data-open={open}>
      <div className="bottom-head">
        <span>Compilação</span>
        <button
          type="button"
          className="icon-btn"
          aria-label={label}
          title={label}
          aria-expanded={open}
          onClick={() => set({ panelOpen: !open })}
        >
          <Icon size={16} aria-hidden="true" />
        </button>
      </div>
      {open && (
        <div className="bottom-body">
          <BuildPanel projectId={projectId} canCompile={canCompile} />
        </div>
      )}
    </div>
  );
}
