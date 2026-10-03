import { useQuery } from '@tanstack/react-query';
import { type CSSProperties, useEffect, useRef } from 'react';
import { Link, useParams } from 'react-router';
import { Editor } from '../components/editor';
import { PdfViewer } from '../components/pdf-viewer';
import { ThemeToggle } from '../components/theme-toggle';
import { ActivityBar } from '../components/workspace/activity-bar';
import { BottomPanel } from '../components/workspace/bottom-panel';
import { DiffTab } from '../components/workspace/diff-tab';
import { Sidebar } from '../components/workspace/sidebar';
import { Splitter } from '../components/workspace/splitter';
import { StatusBar } from '../components/workspace/status-bar';
import { TabBar } from '../components/workspace/tab-bar';
import { useService } from '../di/service-provider';
import { ProjectServiceToken } from '../services/project.service';
import { useSettingsStore } from '../settings-store';
import { useWorkspaceStore } from '../workspace-store';

export function ProjectPage() {
  const { projectId = '' } = useParams();
  const projects = useService(ProjectServiceToken);
  const root = useRef<HTMLDivElement>(null);
  const activePath = useWorkspaceStore((s) => s.activePath);
  const activeTab = useWorkspaceStore((s) => s.tabs.find((t) => t.id === s.activeTabId));
  const hasTabs = useWorkspaceStore((s) => s.tabs.length > 0);
  const openTab = useWorkspaceStore((s) => s.openTab);
  const { sidebarWidth, pdfWidth, panelHeight, panelOpen } = useSettingsStore();
  const {
    data: project,
    error,
    isPending,
  } = useQuery({ queryKey: ['project', projectId], queryFn: () => projects.get(projectId) });
  const mainFile = project?.mainFile;

  useEffect(() => {
    if (mainFile && !hasTabs) openTab({ kind: 'file', path: mainFile });
  }, [mainFile, hasTabs, openTab]);

  if (isPending) return <p className="status-note">Carregando…</p>;
  if (error || !project)
    return (
      <p className="status-note">
        Projeto não encontrado. <Link to="/">Voltar aos projetos</Link>
      </p>
    );

  const canEdit = project.role === 'owner' || project.role === 'editor';
  const path = activePath ?? project.mainFile;
  const style = {
    '--sidebar-w': `${sidebarWidth}px`,
    '--pdf-w': `${pdfWidth}px`,
    '--panel-h': `${panelHeight}px`,
  } as CSSProperties;

  return (
    <div className="workspace-shell">
      <div className="workspace-title">
        <Link to="/" className="brand">
          LaTeX Studio
        </Link>
        <span className="workspace-name">{project.name}</span>
        <span className="workspace-title-end">
          <Link to="/">Projetos</Link>
          <ThemeToggle />
        </span>
      </div>
      <div className="workspace" ref={root} style={style}>
        <ActivityBar projectId={project.id} />
        <details className="sidebar-details" open>
          <summary>Painel</summary>
          <Sidebar project={project} path={path} />
        </details>
        <Splitter root={root} resizes="sidebarWidth" label="Redimensionar barra lateral" />
        <div className="editor-column">
          <TabBar />
          <section className="pane-editor" aria-label={`Editor: ${path}`}>
            {activeTab?.kind === 'diff' ? (
              <DiffTab
                key={activeTab.id}
                projectId={project.id}
                path={activeTab.path}
                from={activeTab.from}
                to={activeTab.to}
              />
            ) : (
              <Editor
                key={`${project.id}/${path}`}
                projectId={project.id}
                path={path}
                role={project.role}
              />
            )}
          </section>
          {panelOpen && (
            <Splitter root={root} resizes="panelHeight" label="Redimensionar painel inferior" />
          )}
          <div className="bottom-slot" data-open={panelOpen}>
            <BottomPanel projectId={project.id} canCompile={canEdit} />
          </div>
        </div>
        <Splitter root={root} resizes="pdfWidth" label="Redimensionar PDF" />
        <PdfViewer projectId={project.id} />
      </div>
      <StatusBar projectId={project.id} role={project.role} />
    </div>
  );
}
