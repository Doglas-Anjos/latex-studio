import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { BuildPanel } from '../components/build-panel';
import { Editor } from '../components/editor';
import { FileTree } from '../components/file-tree';
import { PdfViewer } from '../components/pdf-viewer';
import { useService } from '../di/service-provider';
import { ProjectServiceToken } from '../services/project.service';
import { useWorkspaceStore } from '../workspace-store';

export function ProjectPage() {
  const { projectId = '' } = useParams();
  const projects = useService(ProjectServiceToken);
  const activePath = useWorkspaceStore((s) => s.activePath);
  const {
    data: project,
    error,
    isPending,
  } = useQuery({ queryKey: ['project', projectId], queryFn: () => projects.get(projectId) });

  if (isPending) return <p className="status-note">Carregando…</p>;
  if (error || !project)
    return (
      <p className="status-note">
        Projeto não encontrado. <Link to="/">Voltar aos projetos</Link>
      </p>
    );

  const canEdit = project.role === 'owner' || project.role === 'editor';
  const path = activePath ?? project.mainFile;

  return (
    <div className="workspace">
      <aside className="pane pane-tree">
        <h2 className="pane-title">{project.name}</h2>
        <FileTree projectId={project.id} canEdit={canEdit} mainFile={project.mainFile} />
      </aside>
      <section className="pane pane-editor" aria-label={`Editor: ${path}`}>
        <Editor
          key={`${project.id}/${path}`}
          projectId={project.id}
          path={path}
          role={project.role}
        />
      </section>
      <section className="pane pane-output">
        <BuildPanel projectId={project.id} canCompile={canEdit} />
        <PdfViewer projectId={project.id} />
      </section>
    </div>
  );
}
