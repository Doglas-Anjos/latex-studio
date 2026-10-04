import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { type CSSProperties, useEffect, useRef } from 'react';
import { Link, useParams } from 'react-router';
import { Brand } from '../components/brand';
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
  const sidebarDetailsRef = useRef<HTMLDetailsElement>(null);
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
  const openedFor = useRef<string | null>(null);

  // Only on entering the project, never when the user closes the last tab on purpose.
  useEffect(() => {
    if (!mainFile || openedFor.current === projectId) return;
    if (!hasTabs) openTab({ kind: 'file', path: mainFile });
    openedFor.current = projectId;
  }, [projectId, mainFile, hasTabs, openTab]);

  // Reopens the sidebar when the window grows past the mobile breakpoint, where
  // the <details> toggle is hidden and a closed panel would be unreachable.
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 56.0625rem)');
    const reopenOnDesktop = () => {
      if (mq.matches && sidebarDetailsRef.current) sidebarDetailsRef.current.open = true;
    };
    reopenOnDesktop();
    mq.addEventListener('change', reopenOnDesktop);
    return () => mq.removeEventListener('change', reopenOnDesktop);
  }, []);

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
          <Brand />
        </Link>
        <span className="workspace-sep" aria-hidden="true">
          /
        </span>
        <span className="workspace-name">{project.name}</span>
        <span className="workspace-title-end">
          <Link to="/" className="back-link">
            <ArrowLeft size={14} aria-hidden="true" /> Projetos
          </Link>
          <ThemeToggle />
        </span>
      </div>
      <div className="workspace" ref={root} style={style}>
        <ActivityBar projectId={project.id} />
        <details className="sidebar-details" ref={sidebarDetailsRef} open>
          <summary>Painel</summary>
          <Sidebar project={project} path={path} />
        </details>
        <Splitter root={root} resizes="sidebarWidth" label="Redimensionar barra lateral" />
        <div className="editor-column">
          <TabBar />
          <section
            className="pane-editor"
            aria-label={activeTab ? `Editor: ${path}` : 'Nenhum arquivo aberto'}
          >
            {!activeTab ? (
              <p className="status-note pane-empty">
                Nenhum arquivo aberto. Escolha um arquivo na barra lateral para editar.
              </p>
            ) : activeTab.kind === 'diff' ? (
              <DiffTab
                key={activeTab.id}
                projectId={project.id}
                path={activeTab.path}
                from={activeTab.from}
                to={activeTab.to}
              />
            ) : (
              <Editor
                key={`${project.id}/${activeTab.path}`}
                projectId={project.id}
                path={activeTab.path}
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
