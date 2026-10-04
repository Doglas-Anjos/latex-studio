import { useQuery } from '@tanstack/react-query';
import {
  Files,
  GitCompare,
  History,
  type LucideIcon,
  MessageSquare,
  Package,
  Settings,
  Users,
} from 'lucide-react';
import { useRef } from 'react';
import { useService } from '../../di/service-provider';
import { HistoryServiceToken } from '../../services/history.service';
import { type SidebarView, useSettingsStore } from '../../settings-store';
import { AppearanceDialog } from '../appearance-dialog';

export const viewLabels: Record<SidebarView, string> = {
  files: 'Arquivos',
  changes: 'Mudanças',
  packages: 'Bibliotecas',
  comments: 'Comentários',
  history: 'Histórico',
  members: 'Membros',
};
const icons: Record<SidebarView, LucideIcon> = {
  files: Files,
  changes: GitCompare,
  packages: Package,
  comments: MessageSquare,
  history: History,
  members: Users,
};

export function ActivityBar({ projectId }: { projectId: string }) {
  const appearance = useRef<HTMLDialogElement>(null);
  const view = useSettingsStore((s) => s.sidebarView);
  const set = useSettingsStore((s) => s.set);
  const history = useService(HistoryServiceToken);
  const { data } = useQuery({
    queryKey: ['history', projectId, 'status'],
    queryFn: () => history.status(projectId),
    refetchInterval: 30_000,
  });
  const changed = data?.changes.length ?? 0;
  return (
    <nav className="activity-bar" aria-label="Painéis">
      {(Object.keys(viewLabels) as SidebarView[]).map((v) => {
        const Icon = icons[v];
        return (
          <button
            key={v}
            type="button"
            className="activity-btn"
            aria-pressed={view === v}
            aria-label={viewLabels[v]}
            title={viewLabels[v]}
            onClick={() => set({ sidebarView: v })}
          >
            <Icon size={20} aria-hidden="true" />
            {v === 'changes' && changed > 0 && <span className="activity-badge">{changed}</span>}
          </button>
        );
      })}
      <button
        type="button"
        className="activity-btn activity-settings"
        aria-label="Aparência"
        title="Aparência"
        onClick={() => appearance.current?.showModal()}
      >
        <Settings size={20} aria-hidden="true" />
      </button>
      <AppearanceDialog ref={appearance} />
    </nav>
  );
}
