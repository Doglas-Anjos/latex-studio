import type { Role } from '../../services/project.service';
import { useSettingsStore } from '../../settings-store';
import { useWorkspaceStore } from '../../workspace-store';
import { CommentsPanel } from '../comments-panel';
import { FileTree } from '../file-tree';
import { HistoryPanel } from '../history-panel';
import { MembersPanel } from '../members-panel';
import { PackagesPanel } from '../packages-panel';
import { viewLabels } from './activity-bar';
import { ChangesView } from './changes-view';

export function Sidebar({
  project,
  showHeading = true,
}: {
  project: { id: string; name: string; mainFile: string; role: Role };
  /** Off when a drawer around this component already shows the view's name. */
  showHeading?: boolean;
}) {
  const view = useSettingsStore((s) => s.sidebarView);
  // Read here, not passed down: a tab switch then re-renders the sidebar, not the whole page.
  const path = useWorkspaceStore((s) => s.activePath) ?? project.mainFile;
  const canEdit = project.role === 'owner' || project.role === 'editor';
  return (
    <aside className="sidebar" aria-label={viewLabels[view]}>
      {showHeading && (
        <h2 className="pane-title">
          {viewLabels[view]}
          {view === 'files' && <span className="sidebar-project">{project.name}</span>}
        </h2>
      )}
      <div className="sidebar-body">
        {view === 'files' && (
          <FileTree projectId={project.id} canEdit={canEdit} mainFile={project.mainFile} />
        )}
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
