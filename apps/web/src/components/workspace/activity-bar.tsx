import {
  Files,
  GitCompare,
  History,
  ListTree,
  type LucideIcon,
  MessageSquare,
  Package,
  Settings,
  Users,
} from 'lucide-react';
import { useRef } from 'react';
import { useHistoryStatus } from '../../hooks/use-history-status';
import { type SidebarView, useSettingsStore } from '../../settings-store';
import { SettingsDialog } from '../settings-dialog';

export const viewLabels: Record<SidebarView, string> = {
  files: 'Arquivos',
  changes: 'Mudanças',
  packages: 'Bibliotecas',
  comments: 'Comentários',
  history: 'Histórico',
  navigator: 'Navegador',
  members: 'Membros',
};
export const sidebarViewIcons: Record<SidebarView, LucideIcon> = {
  files: Files,
  changes: GitCompare,
  packages: Package,
  comments: MessageSquare,
  history: History,
  navigator: ListTree,
  members: Users,
};

export function ActivityBar({
  projectId,
  onSelect,
}: {
  projectId: string;
  onSelect?: (view: SidebarView) => void;
}) {
  const settings = useRef<HTMLDialogElement>(null);
  const view = useSettingsStore((s) => s.sidebarView);
  const set = useSettingsStore((s) => s.set);
  const changed = useHistoryStatus(projectId).data?.changes.length ?? 0;
  return (
    <nav className="activity-bar" aria-label="Painéis">
      {(Object.keys(viewLabels) as SidebarView[]).map((v) => {
        const Icon = sidebarViewIcons[v];
        return (
          <button
            key={v}
            type="button"
            className="activity-btn"
            aria-pressed={view === v}
            aria-label={viewLabels[v]}
            title={viewLabels[v]}
            onClick={() => {
              set({ sidebarView: v });
              onSelect?.(v);
            }}
          >
            <Icon size={20} aria-hidden="true" />
            {(v === 'changes' || v === 'files') && changed > 0 && (
              <span className="activity-badge">{changed}</span>
            )}
          </button>
        );
      })}
      <button
        type="button"
        className="activity-btn activity-settings"
        aria-label="Configurações"
        title="Configurações"
        onClick={() => settings.current?.showModal()}
      >
        <Settings size={20} aria-hidden="true" />
      </button>
      <SettingsDialog ref={settings} />
    </nav>
  );
}
