import { useNav } from '../../i18n';
import type { Role } from '../../services/project.service';
import { useSettingsStore } from '../../settings-store';
import { useWorkspaceStore } from '../../workspace-store';
import { CommentsPanel } from '../comments-panel';
import { FileTree } from '../file-tree';
import { HistoryPanel } from '../history-panel';
import { MembersPanel } from '../members-panel';
import { NavigatorPanel } from '../navigator-panel';
import { PackagesPanel } from '../packages-panel';
import { ChangesView } from './changes-view';
import { GraphView } from './graph-view';
import { MapView } from './map-view';

export function Sidebar({
  project,
  showHeading = true,
}: {
  project: { id: string; name: string; mainFile: string; role: Role };
  /** Off when a drawer around this component already shows the view's name. */
  showHeading?: boolean;
}) {
  const view = useSettingsStore((s) => s.sidebarView);
  const labels = useNav().labels;
  // Read here, not passed down: a tab switch then re-renders the sidebar, not the whole page.
  const path = useWorkspaceStore((s) => s.activePath) ?? project.mainFile;
  const canEdit = project.role === 'owner' || project.role === 'editor';
  return (
    <aside className="sidebar" aria-label={labels[view]}>
      {showHeading && (
        <h2 className="pane-title">
          {labels[view]}
          {view === 'files' && <span className="sidebar-project">{project.name}</span>}
        </h2>
      )}
      <div className="sidebar-body">
        {view === 'files' && (
          <FileTree projectId={project.id} canEdit={canEdit} mainFile={project.mainFile} />
        )}
        {view === 'navigator' && <NavigatorPanel projectId={project.id} />}
        {view === 'map' && <MapView projectId={project.id} />}
        {/* Keyed: another project must not inherit this one's layout, pins and colours. */}
        {view === 'graph' && <GraphView key={project.id} projectId={project.id} />}
        {view === 'changes' && <ChangesView projectId={project.id} canEdit={canEdit} />}
        {view === 'packages' && <PackagesPanel projectId={project.id} canEdit={canEdit} />}
        {view === 'comments' && (
          <CommentsPanel projectId={project.id} path={path} role={project.role} />
        )}
        {view === 'history' && (
          <HistoryPanel projectId={project.id} canEdit={canEdit} path={path} />
        )}
        {view === 'members' && (
          <MembersPanel project={project} isOwner={project.role === 'owner'} />
        )}
      </div>
    </aside>
  );
}
