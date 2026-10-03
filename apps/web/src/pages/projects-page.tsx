import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Download, FolderOpen, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Button } from '../components/button';
import {
  CopyDialog,
  CreateDialog,
  ImportDialog,
  type ImportMode,
} from '../components/dashboard/dialogs';
import { useService } from '../di/service-provider';
import { type Project, ProjectServiceToken } from '../services/project.service';
import { useWorkspaceStore } from '../workspace-store';

const dateFmt = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium', timeStyle: 'short' });
const roleLabel = { owner: 'Dono', editor: 'Editor', reviewer: 'Revisor', viewer: 'Leitor' };

type Filter = 'all' | 'mine' | 'shared';
const filters: [Filter, string][] = [
  ['all', 'Todos os projetos'],
  ['mine', 'Meus projetos'],
  ['shared', 'Compartilhados comigo'],
];

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

export function ProjectsPage() {
  const projects = useService(ProjectServiceToken);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { data, error, isPending } = useQuery({
    queryKey: ['projects'],
    queryFn: () => projects.list(),
  });
  const createRef = useRef<HTMLDialogElement>(null);
  const importRef = useRef<HTMLDialogElement>(null);
  const copyRef = useRef<HTMLDialogElement>(null);
  const [importMode, setImportMode] = useState<ImportMode>('zip');
  const [copying, setCopying] = useState<Project | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');

  const open = (id: string) => {
    useWorkspaceStore.getState().setActivePath(null);
    navigate(`/projects/${id}`);
  };
  const openImport = (mode: ImportMode) => {
    setImportMode(mode);
    importRef.current?.showModal();
  };
  const remove = useMutation({
    mutationFn: (id: string) => projects.remove(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['projects'] }),
  });
  const download = useMutation({ mutationFn: (id: string) => projects.downloadSource(id) });

  const q = fold(query.trim());
  const rows = (data ?? [])
    .filter((p) => (filter === 'all' ? true : (p.role === 'owner') === (filter === 'mine')))
    .filter((p) => fold(p.name).includes(q))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  const showCreate = () => createRef.current?.showModal();

  return (
    <div className="dashboard">
      <DashboardSidebar
        filter={filter}
        onFilter={setFilter}
        onCreate={showCreate}
        onImport={openImport}
      />
      <section className="dashboard-main">
        <div className="dashboard-head">
          <h1>Projetos</h1>
          <input
            type="search"
            placeholder="Buscar projeto"
            aria-label="Buscar projeto"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        {isPending && <p className="status-note">Carregando…</p>}
        {error && <p className="form-error">Não foi possível carregar os projetos.</p>}
        {remove.error && <p className="form-error">{remove.error.message}</p>}
        {download.error && <p className="form-error">{download.error.message}</p>}
        {data?.length === 0 && (
          <WelcomeHero onCreate={showCreate} onImport={() => openImport('zip')} />
        )}
        {data && data.length > 0 && rows.length === 0 && (
          <p className="status-note">Nenhum projeto corresponde à busca.</p>
        )}
        {rows.length > 0 && (
          <ProjectTable
            rows={rows}
            onOpen={open}
            onCopy={(p) => {
              setCopying(p);
              copyRef.current?.showModal();
            }}
            onDownload={(id) => download.mutate(id)}
            onRemove={(p) => {
              if (confirm(`Excluir o projeto "${p.name}"? Isso não pode ser desfeito.`))
                remove.mutate(p.id);
            }}
          />
        )}
      </section>

      <CreateDialog dialogRef={createRef} onDone={open} />
      <ImportDialog dialogRef={importRef} mode={importMode} setMode={setImportMode} onDone={open} />
      <CopyDialog dialogRef={copyRef} project={copying} onDone={open} />
    </div>
  );
}

function DashboardSidebar({
  filter,
  onFilter,
  onCreate,
  onImport,
}: {
  filter: Filter;
  onFilter: (f: Filter) => void;
  onCreate: () => void;
  onImport: (m: ImportMode) => void;
}) {
  const menu = useRef<HTMLDetailsElement>(null);
  const pick = (action: () => void) => () => {
    menu.current?.removeAttribute('open');
    action();
  };
  return (
    <aside className="dashboard-side">
      <details className="menu new-menu" ref={menu}>
        <summary className="btn btn-primary">Novo projeto</summary>
        <div className="menu-list">
          <button type="button" onClick={pick(onCreate)}>
            Projeto em branco
          </button>
          <button type="button" onClick={pick(() => onImport('zip'))}>
            Importar .zip
          </button>
          <button type="button" onClick={pick(() => onImport('folder'))}>
            Importar pasta
          </button>
        </div>
      </details>
      <nav className="filter-list" aria-label="Filtros">
        {filters.map(([key, label]) => (
          <button
            key={key}
            type="button"
            aria-pressed={filter === key}
            onClick={() => onFilter(key)}
          >
            {label}
          </button>
        ))}
      </nav>
    </aside>
  );
}

function ProjectTable({
  rows,
  onOpen,
  onCopy,
  onDownload,
  onRemove,
}: {
  rows: Project[];
  onOpen: (id: string) => void;
  onCopy: (p: Project) => void;
  onDownload: (id: string) => void;
  onRemove: (p: Project) => void;
}) {
  return (
    <table className="project-table">
      <thead>
        <tr>
          <th scope="col">Título</th>
          <th scope="col" className="col-owner">
            Dono
          </th>
          <th scope="col">Última modificação</th>
          <th scope="col">
            <span className="sr-only">Ações</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((p) => (
          <tr key={p.id}>
            <td>
              <button type="button" className="project-link" onClick={() => onOpen(p.id)}>
                {p.name}
              </button>
              {p.role !== 'owner' && <span className="muted"> {roleLabel[p.role]}</span>}
            </td>
            <td className="col-owner">{p.role === 'owner' ? 'Você' : 'Compartilhado'}</td>
            <td>{dateFmt.format(new Date(p.updatedAt))}</td>
            <td className="row-actions">
              <IconButton label="Abrir" onClick={() => onOpen(p.id)}>
                <FolderOpen size={16} />
              </IconButton>
              <IconButton label="Fazer uma cópia" onClick={() => onCopy(p)}>
                <Copy size={16} />
              </IconButton>
              <IconButton label="Baixar .zip" onClick={() => onDownload(p.id)}>
                <Download size={16} />
              </IconButton>
              {p.role === 'owner' && (
                <IconButton label="Excluir" onClick={() => onRemove(p)}>
                  <Trash2 size={16} />
                </IconButton>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button type="button" className="icon-btn" aria-label={label} title={label} onClick={onClick}>
      {children}
    </button>
  );
}

function WelcomeHero({ onCreate, onImport }: { onCreate: () => void; onImport: () => void }) {
  return (
    <div className="welcome-hero">
      <h2>Seus projetos LaTeX, com histórico git e compilação na nuvem</h2>
      <p>Escreva em equipe, volte a qualquer versão e gere o PDF sem instalar nada.</p>
      <div className="actions">
        <Button variant="primary" onClick={onCreate}>
          Criar projeto
        </Button>
        <Button variant="secondary" onClick={onImport}>
          Importar
        </Button>
      </div>
    </div>
  );
}
