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
} from 'lucide-react';
import { type FormEvent, type KeyboardEvent, useMemo, useRef, useState } from 'react';
import { useService } from '../../di/service-provider';
import { type FileChange, HistoryServiceToken } from '../../services/history.service';
import { useSettingsStore } from '../../settings-store';
import { useWorkspaceStore } from '../../workspace-store';
import { Button } from '../button';
import { Dialog } from '../dialog';
import { FileTypeIcon } from '../file-tree';

const letter = { add: 'A', modify: 'M', remove: 'D' } as const;
const typeLabel = { add: 'Adicionado', modify: 'Modificado', remove: 'Removido' } as const;

const basename = (path: string) => path.slice(path.lastIndexOf('/') + 1);
const dirname = (path: string) => {
  const i = path.lastIndexOf('/');
  return i === -1 ? '' : path.slice(0, i);
};

function groupChanges(changes: FileChange[]) {
  const byFolder = new Map<string, FileChange[]>();
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
  const [collapsedGroups, setCollapsedGroups] = useState<ReadonlySet<string>>(new Set());
  const discardDialog = useRef<HTMLDialogElement>(null);
  const [discardTarget, setDiscardTarget] = useState<string | null>(null);
  const { data, isPending, isError, isFetching, refetch } = useQuery({
    queryKey: ['history', projectId, 'status'],
    queryFn: () => history.status(projectId),
    refetchInterval: 30_000,
  });
  const baseline = data?.baseline;
  const changes = data?.changes ?? [];
  const groups = useMemo(() => groupChanges(changes), [changes]);
  const showGroupHeaders = groups.length > 1;
  const countLabel =
    changes.length === 0
      ? 'Nenhuma mudança'
      : changes.length === 1
        ? '1 arquivo alterado'
        : `${changes.length} arquivos alterados`;

  const save = useMutation({
    mutationFn: () => history.commit(projectId, message.trim()),
    onSuccess: () => {
      setMessage('');
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
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (message.trim() && !save.isPending) save.mutate();
  };
  const onComposerKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      if (message.trim() && !save.isPending) save.mutate();
    }
  };
  const toggleGroup = (folder: string) =>
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (!next.delete(folder)) next.add(folder);
      return next;
    });

  const renderRow = (c: FileChange) => (
    <li key={c.path} className="change-row">
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
      <span className="change-badge" data-type={c.type}>
        {letter[c.type]}
        <span className="sr-only">{typeLabel[c.type]}</span>
      </span>
    </li>
  );

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
            {baseline ? `· Base: ${baseline.message}` : '· Sem versão salva'}
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
          groups.map((group) =>
            showGroupHeaders ? (
              <section className="change-group" key={group.folder}>
                <button
                  type="button"
                  className="change-group-header"
                  aria-expanded={!collapsedGroups.has(group.folder)}
                  onClick={() => toggleGroup(group.folder)}
                >
                  {collapsedGroups.has(group.folder) ? (
                    <ChevronRight size={14} className="tree-chevron" aria-hidden="true" />
                  ) : (
                    <ChevronDown size={14} className="tree-chevron" aria-hidden="true" />
                  )}
                  <FolderIcon size={14} className="file-icon file-icon-folder" aria-hidden="true" />
                  <span className="change-group-name">{group.folder || 'Raiz do projeto'}</span>{' '}
                  <span className="change-group-count">{group.changes.length}</span>
                </button>
                {!collapsedGroups.has(group.folder) && (
                  <ul className="change-list">{group.changes.map(renderRow)}</ul>
                )}
              </section>
            ) : (
              <ul className="change-list" key={group.folder}>
                {group.changes.map(renderRow)}
              </ul>
            ),
          )}
      </div>
      {canEdit && (
        <form className="changes-composer" onSubmit={submit}>
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
            <Button variant="primary" type="submit" disabled={save.isPending || !message.trim()}>
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
            <Button
              variant="ghost"
              onClick={() => discardDialog.current?.close()}
              disabled={discard.isPending}
            >
              Cancelar
            </Button>
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
    </div>
  );
}
