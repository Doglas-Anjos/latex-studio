import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowRight,
  Boxes,
  CircleHelp,
  Clock3,
  Copy,
  Download,
  FileText,
  FolderOpen,
  GitBranch,
  Plus,
  Search,
  Share2,
  Trash2,
  Users,
} from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useMe } from '../auth-hooks';
import { Button } from '../components/button';
import {
  CopyDialog,
  CreateDialog,
  ImportDialog,
  type ImportMode,
  RemoveDialog,
} from '../components/dashboard/dialogs';
import { HelpDialog } from '../components/dashboard/help-dialog';
import { FasorxFooter } from '../components/fasorx-footer';
import { InviteDialog, openInvite } from '../components/members-panel';
import { Menu } from '../components/menu';
import { ROLE_ICON, RoleBadge } from '../components/role-badge';
import { useService } from '../di/service-provider';
import { useDebounced } from '../hooks/use-debounced';
import { projectCount, useDash } from '../i18n';
import {
  type Project,
  type ProjectFilter,
  ProjectServiceToken,
  type Role,
} from '../services/project.service';

const dateFormat = (locale: string) =>
  new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' });

const PAGE_SIZE = 10;
const FILTER_ORDER: ProjectFilter[] = ['all', 'mine', 'shared'];

export function ProjectsPage() {
  const projects = useService(ProjectServiceToken);
  const navigate = useNavigate();
  const d = useDash();
  const filterLabel: Record<ProjectFilter, string> = {
    all: d.filterAll,
    mine: d.filterMine,
    shared: d.filterShared,
  };
  const [filter, setFilter] = useState<ProjectFilter>('all');
  const [query, setQuery] = useState('');
  const [cursors, setCursors] = useState<Array<string | null>>([null]);
  const [importMode, setImportMode] = useState<ImportMode>('zip');
  const [copying, setCopying] = useState<Project | null>(null);
  const [removing, setRemoving] = useState<Project | null>(null);
  const [sharing, setSharing] = useState<Project | null>(null);
  const createRef = useRef<HTMLDialogElement>(null);
  const importRef = useRef<HTMLDialogElement>(null);
  const copyRef = useRef<HTMLDialogElement>(null);
  const removeRef = useRef<HTMLDialogElement>(null);
  const shareRef = useRef<HTMLDialogElement>(null);
  const helpRef = useRef<HTMLDialogElement>(null);

  const search = useDebounced(query.trim());
  const filtered = filter !== 'all' || search !== '';
  const cursor = cursors.at(-1) ?? null;
  const { data, error, isPending, isPlaceholderData } = useQuery({
    queryKey: ['projects', 'list', filter, search, cursor],
    queryFn: () => projects.list({ limit: PAGE_SIZE, filter, search, cursor }),
    placeholderData: keepPreviousData,
  });
  const download = useMutation({ mutationFn: (id: string) => projects.downloadSource(id) });

  const rows = data?.items ?? [];
  const nextCursor = data?.nextCursor;
  const isFirstPage = cursors.length === 1;
  const recent = !filtered && isFirstPage ? rows[0] : undefined;

  // Deleting the last row of a page leaves it empty: step back to the previous page.
  useEffect(() => {
    if (data?.items.length === 0 && cursors.length > 1) setCursors((c) => c.slice(0, -1));
  }, [data, cursors.length]);

  const open = (id: string) => navigate(`/projects/${id}`);
  const resetPage = () => setCursors([null]);
  const changeFilter = (f: ProjectFilter) => {
    setFilter(f);
    resetPage();
  };
  const changeQuery = (q: string) => {
    setQuery(q);
    resetPage();
  };
  const clearSearch = () => {
    setQuery('');
    setFilter('all');
    resetPage();
  };
  const openCreate = () => createRef.current?.showModal();
  const openImport = (mode: ImportMode) => {
    setImportMode(mode);
    importRef.current?.showModal();
  };
  const openCopy = (p: Project) => {
    setCopying(p);
    copyRef.current?.showModal();
  };
  const openShare = (p: Project) => {
    setSharing(p);
    openInvite(shareRef.current);
  };
  const openRemove = (p: Project) => {
    setRemoving(p);
    removeRef.current?.showModal();
  };

  return (
    <div className="dashboard">
      <section className="dashboard-library" aria-labelledby="dashboard-library-title">
        <div className="dashboard-toolbar">
          <div className="dashboard-heading">
            <h1 id="dashboard-library-title">{d.title}</h1>
            {data && <span className="dashboard-count">{projectCount(d, data.total)}</span>}
            {useMe().data?.isAdmin && (
              <Link to="/admin" className="dashboard-admin-link">
                {d.admin}
              </Link>
            )}
          </div>
          <div className="dashboard-controls">
            <label className="search-field">
              <Search size={16} aria-hidden="true" />
              <input
                type="search"
                placeholder={d.search}
                aria-label={d.search}
                value={query}
                onChange={(e) => changeQuery(e.target.value)}
              />
            </label>
            <Menu
              className="new-menu"
              triggerClassName="btn btn-secondary btn-compact"
              label={
                <>
                  <Plus size={16} aria-hidden="true" /> {d.newProject}
                </>
              }
            >
              <button type="button" onClick={openCreate}>
                {d.blankProject}
              </button>
              <button type="button" onClick={() => openImport('zip')}>
                {d.importZip}
              </button>
              <button type="button" onClick={() => openImport('folder')}>
                {d.importFolder}
              </button>
            </Menu>
          </div>
        </div>

        {recent && <RecentProject project={recent} onOpen={open} />}

        {(!!data?.total || filtered) && (
          <nav className="filter-tabs" aria-label={d.filters}>
            {FILTER_ORDER.map((key) => (
              <button
                key={key}
                type="button"
                aria-pressed={filter === key}
                onClick={() => changeFilter(key)}
              >
                {filterLabel[key]}
              </button>
            ))}
          </nav>
        )}

        {isPending && <p className="status-note">{d.loading}</p>}
        {error && <Alert>{d.loadError}</Alert>}
        {download.error && <Alert>{download.error.message}</Alert>}
        {data?.total === 0 && !filtered && (
          <EmptyLibrary onCreate={openCreate} onImport={() => openImport('zip')} />
        )}
        {data && rows.length === 0 && (data.total > 0 || filtered) && (
          <NoResults onClear={clearSearch} />
        )}
        {rows.length > 0 && (
          <ProjectTable
            rows={rows}
            onOpen={open}
            onCopy={openCopy}
            onShare={openShare}
            onDownload={(id) => download.mutate(id)}
            onRemove={openRemove}
          />
        )}
        {(!!nextCursor || !isFirstPage) && (
          <Pagination
            page={cursors.length}
            total={data?.total}
            // While the next page loads, the shown cursor is the old page's: a second click
            // would push it twice.
            hasPrevious={!isFirstPage && !isPlaceholderData}
            hasNext={!!nextCursor && !isPlaceholderData}
            onPrevious={() => setCursors((c) => c.slice(0, -1))}
            onNext={() => nextCursor && setCursors((c) => [...c, nextCursor])}
          />
        )}
      </section>

      <div className="dashboard-footer">
        <Button variant="ghost" size="compact" onClick={() => helpRef.current?.showModal()}>
          <CircleHelp size={16} aria-hidden="true" /> {d.howItWorks}
        </Button>
      </div>

      <FasorxFooter />

      <HelpDialog dialogRef={helpRef} />
      <CreateDialog dialogRef={createRef} onDone={open} />
      <ImportDialog dialogRef={importRef} mode={importMode} setMode={setImportMode} onDone={open} />
      <CopyDialog dialogRef={copyRef} project={copying} onDone={open} />
      <InviteDialog dialogRef={shareRef} project={sharing} />
      <RemoveDialog dialogRef={removeRef} project={removing} onDone={() => setRemoving(null)} />
    </div>
  );
}

function RecentProject({ project, onOpen }: { project: Project; onOpen: (id: string) => void }) {
  const d = useDash();
  const dateFmt = dateFormat(d.locale);
  return (
    <button
      type="button"
      className="dashboard-recent"
      onClick={() => onOpen(project.id)}
      aria-label={`${d.continuePrefix} ${project.name}`}
    >
      <FileText className="dashboard-recent-icon" size={19} aria-hidden="true" />
      <span className="dashboard-recent-copy">
        <span>{d.recent}</span>
        <span className="dashboard-recent-name">
          <strong>{project.name}</strong>
          <RoleBadge role={project.role} />
        </span>
        <time dateTime={project.updatedAt}>{dateFmt.format(new Date(project.updatedAt))}</time>
      </span>
      <span className="dashboard-recent-action" aria-hidden="true">
        {d.open} <ArrowRight className="dashboard-recent-arrow" size={16} />
      </span>
    </button>
  );
}

function EmptyLibrary({ onCreate, onImport }: { onCreate: () => void; onImport: () => void }) {
  const d = useDash();
  return (
    <div className="dashboard-empty dashboard-empty-start">
      <span className="dashboard-empty-icon" aria-hidden="true">
        <FileText size={26} />
      </span>
      <h2>{d.emptyTitle}</h2>
      <p>{d.emptyText}</p>
      <div className="dashboard-empty-actions">
        <Button variant="primary" onClick={onCreate}>
          {d.createProject}
        </Button>
        <Button variant="secondary" onClick={onImport}>
          {d.importFiles}
        </Button>
      </div>
      <ul className="dashboard-empty-hints">
        <li>
          <GitBranch size={16} aria-hidden="true" />
          {d.hintGit}
        </li>
        <li>
          <Users size={16} aria-hidden="true" />
          {d.hintCollab}
        </li>
        <li>
          <Boxes size={16} aria-hidden="true" />
          {d.hintCompile}
        </li>
      </ul>
    </div>
  );
}

function NoResults({ onClear }: { onClear: () => void }) {
  const d = useDash();
  return (
    <div className="dashboard-empty dashboard-empty-search">
      <Search size={23} aria-hidden="true" />
      <h2>{d.noResultsTitle}</h2>
      <p>{d.noResultsText}</p>
      <Button variant="ghost" onClick={onClear}>
        {d.clearSearch}
      </Button>
    </div>
  );
}

function Pagination({
  page,
  total,
  hasPrevious,
  hasNext,
  onPrevious,
  onNext,
}: {
  page: number;
  total: number | undefined;
  hasPrevious: boolean;
  hasNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
}) {
  const d = useDash();
  return (
    <nav className="dashboard-pagination" aria-label={d.paginationLabel}>
      <span aria-live="polite">
        {d.page} {page}
        {total !== undefined && ` · ${projectCount(d, total)} ${d.totalSuffix}`}
      </span>
      <div>
        <Button variant="secondary" size="compact" disabled={!hasPrevious} onClick={onPrevious}>
          {d.previous}
        </Button>
        <Button variant="secondary" size="compact" disabled={!hasNext} onClick={onNext}>
          {d.next} <ArrowRight size={15} aria-hidden="true" />
        </Button>
      </div>
    </nav>
  );
}

function ProjectTable({
  rows,
  onOpen,
  onCopy,
  onShare,
  onDownload,
  onRemove,
}: {
  rows: Project[];
  onOpen: (id: string) => void;
  onCopy: (p: Project) => void;
  onShare: (p: Project) => void;
  onDownload: (id: string) => void;
  onRemove: (p: Project) => void;
}) {
  const d = useDash();
  const dateFmt = dateFormat(d.locale);
  return (
    <table className="project-table">
      <thead>
        <tr>
          <th scope="col">{d.colTitle}</th>
          <th scope="col">{d.colModified}</th>
          <th scope="col">
            <span className="sr-only">{d.actions}</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((p) => (
          <tr key={p.id} data-role={p.role}>
            <td>
              <button type="button" className="project-link" onClick={() => onOpen(p.id)}>
                <span className="project-link-icon">
                  <RowIcon role={p.role} />
                </span>
                <span className="project-link-text">
                  <strong>{p.name}</strong>
                  <small>{p.mainFile}</small>
                </span>
              </button>
              <RoleBadge role={p.role} />
            </td>
            <td data-label={d.colModified}>
              <Clock3 size={13} className="project-date-icon" aria-hidden="true" />
              <time dateTime={p.updatedAt}>{dateFmt.format(new Date(p.updatedAt))}</time>
            </td>
            <td className="row-actions-cell">
              <div className="row-actions">
                <IconButton label={d.actOpen} onClick={() => onOpen(p.id)}>
                  <FolderOpen size={16} />
                </IconButton>
                {p.role === 'owner' && (
                  <IconButton label={d.actShare} onClick={() => onShare(p)}>
                    <Share2 size={16} />
                  </IconButton>
                )}
                {(p.role === 'owner' || p.role === 'editor') && (
                  <IconButton label={d.actCopy} onClick={() => onCopy(p)}>
                    <Copy size={16} />
                  </IconButton>
                )}
                <IconButton label={d.actDownload} onClick={() => onDownload(p.id)}>
                  <Download size={16} />
                </IconButton>
                {p.role === 'owner' && (
                  <IconButton label={d.actRemove} onClick={() => onRemove(p)}>
                    <Trash2 size={16} />
                  </IconButton>
                )}
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function RowIcon({ role }: { role: Role }) {
  const Icon = role === 'reviewer' || role === 'viewer' ? ROLE_ICON[role] : FileText;
  return <Icon size={17} aria-hidden="true" />;
}

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="icon-btn row-action-btn"
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function Alert({ children }: { children: ReactNode }) {
  return (
    <p className="alert" role="alert">
      <AlertTriangle size={16} aria-hidden="true" />
      {children}
    </p>
  );
}
