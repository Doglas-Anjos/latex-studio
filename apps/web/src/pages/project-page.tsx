import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Code2, FileText, PanelRightClose, PanelRightOpen, X } from 'lucide-react';
import { type CSSProperties, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { Brand } from '../components/brand';
import { Button } from '../components/button';
import { Editor } from '../components/editor';
import { PdfViewer } from '../components/pdf-viewer';
import { ThemeToggle } from '../components/theme-toggle';
import { ActivityBar, sidebarViewIcons, viewLabels } from '../components/workspace/activity-bar';
import { BottomPanel } from '../components/workspace/bottom-panel';
import { DiffTab } from '../components/workspace/diff-tab';
import { Sidebar } from '../components/workspace/sidebar';
import { Splitter } from '../components/workspace/splitter';
import { StatusBar } from '../components/workspace/status-bar';
import { TabBar } from '../components/workspace/tab-bar';
import { useMatchMedia } from '../components/workspace/use-match-media';
import { useSidebarVisibility } from '../components/workspace/use-sidebar-visibility';
import { useService } from '../di/service-provider';
import { ProjectServiceToken } from '../services/project.service';
import { useSettingsStore } from '../settings-store';
import { useWorkspaceStore } from '../workspace-store';
import '../workspace-header.css';

// Below this, a 3rd column for the PDF has nowhere to go: one main surface at a time instead.
const COMPACT_QUERY = '(max-width: 75rem)';
type Surface = 'editor' | 'pdf';

export function ProjectPage() {
  const { projectId = '' } = useParams();
  const projects = useService(ProjectServiceToken);
  const root = useRef<HTMLDivElement>(null);
  const activePath = useWorkspaceStore((s) => s.activePath);
  const activeTab = useWorkspaceStore((s) => s.tabs.find((t) => t.id === s.activeTabId));
  const openTab = useWorkspaceStore((s) => s.openTab);
  const sidebarWidth = useSettingsStore((s) => s.sidebarWidth);
  const pdfWidth = useSettingsStore((s) => s.pdfWidth);
  const panelHeight = useSettingsStore((s) => s.panelHeight);
  const panelOpen = useSettingsStore((s) => s.panelOpen);
  const sidebarView = useSettingsStore((s) => s.sidebarView);
  const setSettings = useSettingsStore((s) => s.set);
  const [surface, setSurface] = useState<Surface>('editor');
  const compact = useMatchMedia(COMPACT_QUERY);
  const {
    data: project,
    error,
    isPending,
  } = useQuery({ queryKey: ['project', projectId], queryFn: () => projects.get(projectId) });
  const mainFile = project?.mainFile;
  const openedFor = useRef<string | null>(null);

  // Tabs, peers and the active file belong to one project. The guard keeps StrictMode's second
  // effect pass from wiping the main-file tab opened just below.
  useEffect(() => {
    if (openedFor.current !== projectId) useWorkspaceStore.getState().reset();
  }, [projectId]);
  // Only on entering the project, never when the user closes the last tab on purpose. Tabs are
  // read from the store: the rendered value may predate the reset above.
  useEffect(() => {
    if (!mainFile || openedFor.current === projectId) return;
    if (useWorkspaceStore.getState().tabs.length === 0) openTab({ kind: 'file', path: mainFile });
    openedFor.current = projectId;
  }, [projectId, mainFile, openTab]);

  // Below this, the workspace collapses to one flex column and the sidebar
  // becomes a <dialog> sheet instead of a fixed-width column.
  const {
    wideEnough: wideEnoughForOpenSidebar,
    open: sidebarOpen,
    setOpen: setSidebarOpen,
  } = useSidebarVisibility('(min-width: 56.0625rem)');
  // Picking a section from the activity bar on mobile reopens the sidebar to
  // show it; the user can collapse it again once they've seen it.
  const openSidebarOnMobile = () => {
    if (!wideEnoughForOpenSidebar) setSidebarOpen(true);
  };
  // Below 56.0625rem the sidebar is a <dialog> sheet over the editor instead
  // of a column that would otherwise leave it almost no width; `sidebarOpen`
  // drives showModal()/close() instead of a CSS-only collapse.
  const sidebarDialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = sidebarDialog.current;
    if (!el || wideEnoughForOpenSidebar) return;
    if (sidebarOpen && !el.open) el.showModal();
    if (!sidebarOpen && el.open) el.close();
  }, [sidebarOpen, wideEnoughForOpenSidebar]);
  // A comment started from the editor (contextual action, margin button or
  // shortcut) always lands in the comments panel, even over another sidebar
  // view or a sidebar collapsed on mobile.
  const commentDraft = useWorkspaceStore((s) => s.commentDraft);
  useEffect(() => {
    if (!commentDraft) return;
    setSettings({ sidebarView: 'comments' });
    if (!wideEnoughForOpenSidebar) setSidebarOpen(true);
  }, [commentDraft, wideEnoughForOpenSidebar, setSidebarOpen, setSettings]);

  if (isPending) return <p className="status-note">Carregando…</p>;
  if (error || !project)
    return (
      <p className="status-note">
        Projeto não encontrado. <Link to="/">Voltar aos projetos</Link>
      </p>
    );

  const canEdit = project.role === 'owner' || project.role === 'editor';
  const path = activePath ?? project.mainFile;
  const SidebarIcon = sidebarViewIcons[sidebarView];
  const style = {
    '--sidebar-w': `${sidebarWidth}px`,
    '--pdf-w': `${pdfWidth}px`,
    '--panel-h': `${panelHeight}px`,
  } as CSSProperties;

  return (
    <div className="workspace-shell">
      <header className="wsh-header">
        <div className="wsh-start">
          <Link to="/" className="wsh-brand" title="LaTeX Studio — ir para Projetos">
            <Brand />
          </Link>
          <span className="wsh-sep" aria-hidden="true">
            /
          </span>
          <span className="wsh-project-name" title={project.name}>
            {project.name}
          </span>
        </div>
        {compact && (
          <fieldset className="wsh-segmented">
            <legend className="sr-only">Superfície principal</legend>
            <button
              type="button"
              className="wsh-segmented-btn"
              aria-pressed={surface === 'editor'}
              aria-label="Mostrar código"
              title="Mostrar código"
              onClick={() => setSurface('editor')}
            >
              <Code2 size={14} aria-hidden="true" />
              <span>Código</span>
            </button>
            <button
              type="button"
              className="wsh-segmented-btn"
              aria-pressed={surface === 'pdf'}
              aria-label="Mostrar PDF"
              title="Mostrar PDF"
              onClick={() => setSurface('pdf')}
            >
              <FileText size={14} aria-hidden="true" />
              <span>PDF</span>
            </button>
          </fieldset>
        )}
        <div className="wsh-end">
          <Link
            to="/"
            className="wsh-back"
            aria-label="Voltar para Projetos"
            title="Voltar para Projetos"
          >
            <ArrowLeft size={16} aria-hidden="true" />
            <span>Projetos</span>
          </Link>
          <span className="wsh-divider" aria-hidden="true" />
          <ThemeToggle />
        </div>
      </header>
      <div className="workspace" ref={root} style={style} data-surface={surface}>
        <ActivityBar projectId={project.id} onSelect={openSidebarOnMobile} />
        {wideEnoughForOpenSidebar ? (
          <>
            <Sidebar project={project} path={path} />
            <Splitter root={root} resizes="sidebarWidth" label="Redimensionar barra lateral" />
          </>
        ) : (
          // biome-ignore lint/a11y/useKeyWithClickEvents: closes on a backdrop click; Escape already closes it natively.
          <dialog
            ref={sidebarDialog}
            className="sidebar-sheet"
            aria-label={viewLabels[sidebarView]}
            onClose={() => setSidebarOpen(false)}
            onClick={(e) => {
              if (e.target === e.currentTarget) e.currentTarget.close();
            }}
          >
            <div className="sidebar-sheet-header">
              <SidebarIcon size={16} aria-hidden="true" />
              <span>{viewLabels[sidebarView]}</span>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Fechar"
                onClick={() => sidebarDialog.current?.close()}
              >
                <X size={16} aria-hidden="true" />
              </Button>
            </div>
            <Sidebar project={project} path={path} showHeading={false} />
          </dialog>
        )}
        <div className="main-column">
          <div className="surface-row">
            <div className="editor-pane">
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
            </div>
            {(!compact || surface === 'pdf') &&
              (pdfWidth === 0 && !compact ? (
                <button
                  type="button"
                  className="pdf-collapsed"
                  title="Mostrar PDF"
                  onClick={() => setSettings({ pdfWidth: 480 })}
                >
                  <PanelRightOpen size={16} aria-hidden="true" />
                  <span>PDF</span>
                </button>
              ) : (
                <>
                  {!compact && (
                    <div className="pdf-divider">
                      <Splitter root={root} resizes="pdfWidth" label="Redimensionar PDF" />
                      <button
                        type="button"
                        className="pdf-collapse"
                        title="Ocultar PDF"
                        aria-label="Ocultar PDF"
                        onClick={() => setSettings({ pdfWidth: 0 })}
                      >
                        <PanelRightClose size={14} aria-hidden="true" />
                      </button>
                    </div>
                  )}
                  <PdfViewer projectId={project.id} />
                </>
              ))}
          </div>
          {panelOpen && (
            <Splitter root={root} resizes="panelHeight" label="Redimensionar painel inferior" />
          )}
          <div className="bottom-slot" data-open={panelOpen}>
            <BottomPanel projectId={project.id} canCompile={canEdit} />
          </div>
        </div>
      </div>
      <StatusBar
        projectId={project.id}
        role={project.role}
        path={activeTab?.kind === 'file' ? activeTab.path : null}
      />
    </div>
  );
}
