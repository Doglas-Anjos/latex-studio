import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  FileText,
  Folder as FolderIcon,
  History,
  RefreshCw,
  Undo2,
  Users,
} from 'lucide-react';
import { type FormEvent, Fragment, type KeyboardEvent, useMemo, useRef, useState } from 'react';
import { useService } from '../../di/service-provider';
import {
  HistoryServiceToken,
  type StatusChange,
  splitCommitMessage,
} from '../../services/history.service';
import { useSettingsStore } from '../../settings-store';
import { useWorkspaceStore } from '../../workspace-store';
import { Button } from '../button';
import { Dialog } from '../dialog';
import { FileTypeIcon } from '../file-tree';
import { basename } from './tab-bar';

const letter = { add: 'A', modify: 'M', remove: 'D' } as const;
const typeLabel = { add: 'Adicionado', modify: 'Modificado', remove: 'Removido' } as const;

type Author = 'mine' | 'shared' | 'others';
// Older status payloads (and some tests) omit the authorship fields; treat them as "mine" so an
// absent attribution never warns on commit.
// ponytail: a change with no recorded collaborative editor (an upload or restore, possibly by
// someone else) also falls here and shows under "Suas alterações". The commit warning stays
// correct (it keys off `others`); only the group label can over-claim. A 4th "outras" bucket if
// cross-user uploads need their own heading.
const authorOf = (c: StatusChange): Author =>
  (c.others?.length ?? 0) === 0 ? 'mine' : c.mine ? 'shared' : 'others';
const othersOf = (c: StatusChange) => c.others ?? [];
const authorsLabel = (c: StatusChange): string | null => {
  const others = othersOf(c);
  if (others.length === 0) return null;
  return c.mine ? `você + ${others.join(', ')}` : others.join(', ');
};
// Others' work shown first: that is what the person needs to notice before saving a version.
const AUTHOR_GROUPS: Array<[Author, string]> = [
  ['others', 'Editadas por outras pessoas'],
  ['shared', 'Editadas por você e outras pessoas'],
  ['mine', 'Suas alterações'],
];

const dirname = (path: string) => {
  const i = path.lastIndexOf('/');
  return i === -1 ? '' : path.slice(0, i);
};

function groupChanges(changes: StatusChange[]) {
  const byFolder = new Map<string, StatusChange[]>();
  for (const change of changes) {
    const folder = dirname(change.path);
    const list = byFolder.get(folder);
    if (list) list.push(change);
    else byFolder.set(folder, [change]);
  }
  return [...byFolder.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([folder, items]) => ({
      folder,
      changes: items.sort((a, b) => a.path.localeCompare(b.path)),
    }));
}

export function ChangesView({ projectId, canEdit }: { projectId: string; canEdit: boolean }) {
  const history = useService(HistoryServiceToken);
  const queryClient = useQueryClient();
  const setActivePath = useWorkspaceStore((s) => s.setActivePath);
  const openTab = useWorkspaceStore((s) => s.openTab);
  const setSettings = useSettingsStore((s) => s.set);
  const [message, setMessage] = useState('');
  // Files left out of the next version (VS Code's unstaged); everything is included by default,
  // and a file that changes again stays as the user left it.
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(new Set());
  const [collapsedGroups, setCollapsedGroups] = useState<ReadonlySet<string>>(new Set());
  const discardDialog = useRef<HTMLDialogElement>(null);
  const warnDialog = useRef<HTMLDialogElement>(null);
  const [discardTarget, setDiscardTarget] = useState<string | null>(null);
  const { data, isPending, isError, isFetching, refetch } = useQuery({
    queryKey: ['history', projectId, 'status'],
    queryFn: () => history.status(projectId),
    refetchInterval: 30_000,
  });
  const baseline = data?.baseline;
  const changes = data?.changes ?? [];
  const byAuthor = useMemo(() => {
    const buckets: Record<Author, StatusChange[]> = { others: [], shared: [], mine: [] };
    for (const c of changes) buckets[authorOf(c)].push(c);
    return AUTHOR_GROUPS.map(([key, label]) => ({
      key,
      label,
      count: buckets[key].length,
      folders: groupChanges(buckets[key]),
    })).filter((g) => g.count > 0);
  }, [changes]);
  const showAuthorHeaders = byAuthor.length > 1;
  const selected = changes.filter((c) => !excluded.has(c.path)).map((c) => c.path);
  const allSelected = selected.length === changes.length;
  // Selected files that someone else also edited: committing these takes their work too.
  const othersInSelection = changes.filter((c) => !excluded.has(c.path) && othersOf(c).length > 0);
  const toggleFile = (path: string) =>
    setExcluded((prev) => {
      const next = new Set(prev);
      if (!next.delete(path)) next.add(path);
      return next;
    });
  const toggleAll = () =>
    setExcluded(allSelected ? new Set(changes.map((c) => c.path)) : new Set());
  const countLabel =
    changes.length === 0
      ? 'Nenhuma mudança'
      : changes.length === 1
        ? '1 arquivo alterado'
        : `${changes.length} arquivos alterados`;

  const save = useMutation({
    mutationFn: () => history.commit(projectId, message.trim(), allSelected ? undefined : selected),
    onSuccess: () => {
      setMessage('');
      setExcluded(new Set());
      warnDialog.current?.close();
      return queryClient.invalidateQueries({ queryKey: ['history', projectId] });
    },
  });
  const discard = useMutation({
    mutationFn: (path: string) => history.restore(projectId, baseline?.sha ?? '', path),
    onSuccess: () => {
      discardDialog.current?.close();
      setDiscardTarget(null);
      return Promise.all([
        queryClient.invalidateQueries({ queryKey: ['history', projectId] }),
        queryClient.invalidateQueries({ queryKey: ['files', projectId] }),
      ]);
    },
  });
  // Committing a file someone else also edited takes their uncommitted work into the version, so
  // confirm first. The commit itself credits them as co-authors.
  const attemptSave = () => {
    if (!message.trim() || selected.length === 0 || save.isPending) return;
    if (othersInSelection.length > 0) warnDialog.current?.showModal();
    else save.mutate();
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    attemptSave();
  };
  const onComposerKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      attemptSave();
    }
  };
  const toggleGroup = (folder: string) =>
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (!next.delete(folder)) next.add(folder);
      return next;
    });

  // `folders` is pre-grouped (byAuthor). The collapse key is namespaced by author so the same
  // folder in two author sections collapses independently.
  const renderFolderGroups = (author: Author, folders: ReturnType<typeof groupChanges>) => {
    const showGroupHeaders = folders.length > 1;
    return folders.map((group) => {
      const key = `${author}:${group.folder}`;
      return showGroupHeaders ? (
        <section className="change-group" key={key}>
          <button
            type="button"
            className="change-group-header"
            aria-expanded={!collapsedGroups.has(key)}
            onClick={() => toggleGroup(key)}
          >
            {collapsedGroups.has(key) ? (
              <ChevronRight size={14} className="tree-chevron" aria-hidden="true" />
            ) : (
              <ChevronDown size={14} className="tree-chevron" aria-hidden="true" />
            )}
            <FolderIcon size={14} className="file-icon file-icon-folder" aria-hidden="true" />
            <span className="change-group-name">{group.folder || 'Raiz do projeto'}</span>{' '}
            <span className="change-group-count">{group.changes.length}</span>
          </button>
          {!collapsedGroups.has(key) && (
            <ul className="change-list">{group.changes.map(renderRow)}</ul>
          )}
        </section>
      ) : (
        <ul className="change-list" key={key}>
          {group.changes.map(renderRow)}
        </ul>
      );
    });
  };

  const renderRow = (c: StatusChange) => {
    const authors = authorsLabel(c);
    return (
      <li
        key={c.path}
        className="change-row"
        data-excluded={excluded.has(c.path)}
        data-author={authorOf(c)}
      >
        {canEdit && (
          <input
            type="checkbox"
            className="change-check"
            checked={!excluded.has(c.path)}
            aria-label={`Incluir ${c.path} na versão`}
            title="Incluir na próxima versão"
            onChange={() => toggleFile(c.path)}
          />
        )}
        {c.type === 'remove' ? (
          <span className="change-row-main" title={c.path}>
            <FileTypeIcon name={c.path} />
            <span className="change-name">{basename(c.path)}</span>
          </span>
        ) : (
          <button
            type="button"
            className="change-row-main"
            title={c.path}
            onClick={() =>
              openTab({
                kind: 'diff',
                path: c.path,
                from: baseline?.sha ?? 'empty',
                to: 'work',
              })
            }
          >
            <FileTypeIcon name={c.path} />
            <span className="change-name">{basename(c.path)}</span>
          </button>
        )}
        <span className="change-row-actions">
          {c.type !== 'remove' && (
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Abrir arquivo ${c.path}`}
              title="Abrir arquivo"
              onClick={() => setActivePath(c.path)}
            >
              <FileText size={14} aria-hidden="true" />
            </Button>
          )}
          {canEdit && baseline && c.type === 'modify' && (
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Descartar alterações de ${c.path}`}
              title="Descartar alterações"
              disabled={discard.isPending}
              onClick={() => {
                setDiscardTarget(c.path);
                discardDialog.current?.showModal();
              }}
            >
              <Undo2 size={14} aria-hidden="true" />
            </Button>
          )}
        </span>
        {authors && (
          <span className="change-authors" title={`Editado por ${authors}`}>
            {authors}
          </span>
        )}
        <span className="change-badge" data-type={c.type}>
          {letter[c.type]}
          <span className="sr-only">{typeLabel[c.type]}</span>
        </span>
      </li>
    );
  };

  return (
    <div className="changes-view">
      <div className="changes-head">
        <div className="changes-summary">
          <span className="changes-count">{countLabel}</span>
          <span
            className="changes-baseline"
            title={
              baseline
                ? `${baseline.message} · ${new Date(baseline.date).toLocaleString()}`
                : undefined
            }
          >
            {baseline
              ? `· Base: ${splitCommitMessage(baseline.message).subject}`
              : '· Sem versão salva'}
          </span>
        </div>
        <div className="changes-head-actions">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Atualizar mudanças"
            title="Atualizar mudanças"
            disabled={isFetching}
            onClick={() => refetch()}
          >
            <RefreshCw size={14} className={isFetching ? 'spin' : undefined} aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Ver histórico"
            title="Ver histórico"
            onClick={() => setSettings({ sidebarView: 'history' })}
          >
            <History size={14} aria-hidden="true" />
          </Button>
        </div>
      </div>
      <div className="changes-body">
        {isPending && <p className="status-note">Carregando mudanças…</p>}
        {isError && (
          <p className="alert" role="alert">
            <AlertTriangle size={16} aria-hidden="true" />
            <span>Não foi possível carregar as mudanças.</span>
            <Button variant="ghost" size="compact" onClick={() => refetch()}>
              Tentar de novo
            </Button>
          </p>
        )}
        {data && changes.length === 0 && (
          <p className="muted empty">
            Nenhuma mudança para salvar. Edite um arquivo para ver as alterações aqui.
          </p>
        )}
        {data &&
          byAuthor.map((g) =>
            showAuthorHeaders ? (
              <section className="change-author-group" key={g.key}>
                <h3 className="change-author-header" data-author={g.key}>
                  {g.key !== 'mine' && <Users size={13} aria-hidden="true" />}
                  <span className="change-author-name">{g.label}</span>
                  <span className="change-author-count">{g.count}</span>
                </h3>
                {renderFolderGroups(g.key, g.folders)}
              </section>
            ) : (
              <Fragment key={g.key}>{renderFolderGroups(g.key, g.folders)}</Fragment>
            ),
          )}
      </div>
      {canEdit && (
        <form className="changes-composer" onSubmit={submit}>
          {changes.length > 0 && (
            <label className="changes-select-all">
              <input type="checkbox" checked={allSelected} onChange={toggleAll} />
              {allSelected
                ? `Todos os ${changes.length} arquivos entram na versão`
                : `${selected.length} de ${changes.length} arquivos entram na versão`}
            </label>
          )}
          {othersInSelection.length > 0 && (
            <p className="changes-others-note">
              <Users size={13} aria-hidden="true" />
              {othersInSelection.length === 1
                ? '1 arquivo selecionado também foi editado por outra pessoa.'
                : `${othersInSelection.length} arquivos selecionados também foram editados por outras pessoas.`}
            </p>
          )}
          <textarea
            placeholder="Mensagem da versão"
            aria-label="Mensagem da versão"
            rows={2}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={onComposerKeyDown}
          />
          <div className="changes-composer-actions">
            {save.error && <p className="form-error">{save.error.message}</p>}
            <Button
              variant="primary"
              type="submit"
              disabled={save.isPending || !message.trim() || selected.length === 0}
            >
              {save.isPending ? 'Salvando…' : 'Salvar versão'}
            </Button>
          </div>
        </form>
      )}
      <Dialog
        ref={discardDialog}
        title="Descartar alterações"
        icon={<Undo2 size={18} aria-hidden="true" />}
        kicker={discardTarget ? <code>{discardTarget}</code> : undefined}
        description="O arquivo volta ao conteúdo da versão base. Essa ação não pode ser desfeita."
        tone="danger"
        pending={discard.isPending}
        footer={
          <div className="actions">
            <Dialog.Cancel />
            <Button
              variant="danger"
              onClick={() => discardTarget && discard.mutate(discardTarget)}
              disabled={discard.isPending}
            >
              {discard.isPending ? 'Descartando…' : 'Descartar'}
            </Button>
          </div>
        }
      >
        {discard.error && <p className="form-error">{discard.error.message}</p>}
      </Dialog>
      <Dialog
        ref={warnDialog}
        title="Salvar trabalho de outras pessoas?"
        icon={<Users size={18} aria-hidden="true" />}
        description="Estes arquivos selecionados também foram editados por outras pessoas desde a última versão. Salvar inclui o trabalho delas, e elas entram como coautoras do commit."
        pending={save.isPending}
        footer={
          <div className="actions">
            <Dialog.Cancel />
            <Button variant="primary" onClick={() => save.mutate()} disabled={save.isPending}>
              {save.isPending ? 'Salvando…' : 'Salvar mesmo assim'}
            </Button>
          </div>
        }
      >
        <ul className="changes-others-list">
          {othersInSelection.map((c) => (
            <li key={c.path}>
              <FileTypeIcon name={c.path} />
              <span className="change-name" title={c.path}>
                {basename(c.path)}
              </span>
              <span className="change-authors">{authorsLabel(c)}</span>
            </li>
          ))}
        </ul>
        {save.error && <p className="form-error">{save.error.message}</p>}
      </Dialog>
    </div>
  );
}
