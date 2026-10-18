import {
  Files,
  GitCompare,
  History,
  ListTree,
  type LucideIcon,
  MessageSquare,
  Network,
  Package,
  Settings,
  Users,
  Waypoints,
} from 'lucide-react';
import { useRef } from 'react';
import { useHistoryStatus } from '../../hooks/use-history-status';
import { useNav } from '../../i18n';
import { type SidebarView, useSettingsStore } from '../../settings-store';
import { SettingsDialog } from '../settings-dialog';

export const sidebarViewIcons: Record<SidebarView, LucideIcon> = {
  files: Files,
  navigator: ListTree,
  map: Waypoints,
  graph: Network,
  changes: GitCompare,
  packages: Package,
  comments: MessageSquare,
  history: History,
  members: Users,
};
const VIEWS = Object.keys(sidebarViewIcons) as SidebarView[];

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
  const nav = useNav();
  const changed = useHistoryStatus(projectId).data?.changes.length ?? 0;
  return (
    <nav className="activity-bar" aria-label="Painéis">
      {VIEWS.map((v) => {
        const Icon = sidebarViewIcons[v];
        return (
          <button
            key={v}
            type="button"
            className="activity-btn"
            aria-pressed={view === v}
            aria-label={nav.labels[v]}
            title={nav.titles[v]}
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
        aria-label={nav.settings.label}
        title={nav.settings.title}
        onClick={() => settings.current?.showModal()}
      >
        <Settings size={20} aria-hidden="true" />
      </button>
      <SettingsDialog ref={settings} projectId={projectId} />
    </nav>
  );
}
