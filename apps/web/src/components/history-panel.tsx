import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, GitCompare, RotateCcw } from 'lucide-react';
import { type FormEvent, useRef, useState } from 'react';
import { useService } from '../di/service-provider';
import { HistoryServiceToken } from '../services/history.service';
import { useWorkspaceStore } from '../workspace-store';
import { Button } from './button';
import { Dialog } from './dialog';

type Scope = 'project' | 'file';

export function HistoryPanel({
  projectId,
  canEdit,
  path,
}: {
  projectId: string;
  canEdit: boolean;
  /** The active file; drives the "Arquivo atual" scope. */
  path: string;
}) {
  const service = useService(HistoryServiceToken);
  const queryClient = useQueryClient();
  const dialog = useRef<HTMLDialogElement>(null);
  const restoreDialog = useRef<HTMLDialogElement>(null);
  const [scope, setScope] = useState<Scope>('project');
  const [selected, setSelected] = useState<string | null>(null);
  const [viewing, setViewing] = useState<{ path: string; text: string } | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<{ sha: string; path: string } | null>(null);
  const [message, setMessage] = useState('');
  const { data: log = [] } = useQuery({
    queryKey: ['history', projectId],
    queryFn: () => service.log(projectId, 50),
    enabled: scope === 'project',
  });
  // Changes are shown against the previous commit in the list (the log is newest first).
  const index = log.findIndex((e) => e.sha === selected);
  const parent = log[index + 1];
  const { data: changes = [] } = useQuery({
    queryKey: ['history', projectId, 'changes', selected, parent?.sha],
    queryFn: () => service.changes(projectId, parent?.sha ?? '', selected ?? ''),
    enabled: scope === 'project' && selected !== null && parent !== undefined,
  });
  const { data: status } = useQuery({
    queryKey: ['history', projectId, 'status'],
    queryFn: () => service.status(projectId),
    enabled: scope === 'file',
  });
  const { data: fileLog = [] } = useQuery({
    queryKey: ['history', projectId, 'file-log', path],
    queryFn: () => service.fileLog(projectId, path),
    enabled: scope === 'file' && !!path,
  });
  const fileChange = status?.changes.find((c) => c.path === path);
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['files', projectId] }),
      queryClient.invalidateQueries({ queryKey: ['history', projectId] }),
    ]);
  const save = useMutation({
    mutationFn: (message: string) => service.commit(projectId, message),
    onSuccess: () => {
      setMessage('');
      return refresh();
    },
  });
  const restore = useMutation({
    mutationFn: ({ sha, path }: { sha: string; path: string }) =>
      service.restore(projectId, sha, path),
    onSuccess: () => {
      restoreDialog.current?.close();
      setRestoreTarget(null);
      return refresh();
    },
  });
  const openTab = useWorkspaceStore((st) => st.openTab);
  const [mark, setMark] = useState<string | null>(null);
  // Opens one diff tab per changed file; the first one ends up active.
  const compare = useMutation({
    mutationFn: async ({ from, to }: { from: string; to: string }) => {
      const files = await service.changes(projectId, from, to);
      for (const c of [...files].reverse())
        if (c.type !== 'remove') openTab({ kind: 'diff', path: c.path, from, to });
    },
  });
  const toggleMark = (sha: string) => {
    if (mark === null || mark === sha) return setMark(mark === sha ? null : sha);
    const [newer, older] =
      log.findIndex((x) => x.sha === mark) < log.findIndex((x) => x.sha === sha)
        ? [mark, sha]
        : [sha, mark];
    setMark(null);
    compare.mutate({ from: older, to: newer });
  };
  const view = useMutation({
    mutationFn: async ({ sha, path }: { sha: string; path: string }) => ({
      path,
      text: await service.file(projectId, sha, path),
    }),
    onSuccess: (v) => {
      setViewing(v);
      dialog.current?.showModal();
    },
  });

  const submitMessage = (e: FormEvent) => {
    e.preventDefault();
    if (message.trim()) save.mutate(message.trim());
  };
  const error = save.error ?? view.error ?? compare.error;

  return (
    <section className="history-panel" aria-label="Histórico">
      <fieldset className="view-toggle">
        <legend className="sr-only">Escopo do histórico</legend>
        <button
          type="button"
          className="view-toggle-btn"
          aria-pressed={scope === 'project'}
          onClick={() => setScope('project')}
        >
          Projeto
        </button>
        <button
          type="button"
          className="view-toggle-btn"
          aria-pressed={scope === 'file'}
          onClick={() => setScope('file')}
        >
          Arquivo atual
        </button>
      </fieldset>
      {scope === 'project' && canEdit && (
        <form className="change-form" onSubmit={submitMessage}>
          <input
            placeholder="Mensagem da versão"
            aria-label="Mensagem da versão"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
          <Button variant="secondary" type="submit" disabled={save.isPending || !message.trim()}>
            Salvar versão
          </Button>
        </form>
      )}
      {scope === 'project' ? (
        <ul className="history-list">
          {log.map((e, i) => (
            <li key={e.sha}>
              <button
                type="button"
                className="history-entry"
                aria-pressed={e.sha === selected}
                onClick={() => setSelected(e.sha === selected ? null : e.sha)}
              >
                <span className="history-message">{e.message}</span>
                <small>
                  {e.author.name} · {new Date(e.date).toLocaleString('pt-BR')}
                </small>
              </button>
              <span className="history-compare">
                <Button
                  variant="ghost"
                  disabled={!log[i + 1]}
                  onClick={() => compare.mutate({ from: log[i + 1]?.sha ?? '', to: e.sha })}
                >
                  <GitCompare size={14} aria-hidden /> Comparar com anterior
                </Button>
                <Button
                  variant="ghost"
                  aria-pressed={mark === e.sha}
                  onClick={() => toggleMark(e.sha)}
                >
                  Comparar
                </Button>
              </span>
              {e.sha === selected && (
                <ul className="history-changes">
                  {!parent && <li className="comment-empty">Primeira versão.</li>}
                  {changes.map((c) => (
                    <li key={c.path}>
                      <code>
                        {c.type} {c.path}
                      </code>
                      {c.type !== 'remove' && (
                        <Button
                          variant="ghost"
                          onClick={() => view.mutate({ sha: e.sha, path: c.path })}
                        >
                          ver
                        </Button>
                      )}
                      {canEdit && (
                        <Button
                          variant="danger"
                          onClick={() => {
                            setRestoreTarget({ sha: e.sha, path: c.path });
                            restoreDialog.current?.showModal();
                          }}
                        >
                          restaurar
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <>
          <p className="history-file-path comment-draft-scope" title={path}>
            {path}
          </p>
          {fileChange ? (
            <p className="comment-draft-note">
              {fileChange.type === 'add'
                ? 'Arquivo novo, ainda não salvo.'
                : fileChange.type === 'remove'
                  ? 'Arquivo removido, ainda não salvo.'
                  : 'Alterações não salvas.'}
              {fileChange.type !== 'remove' && (
                <Button
                  variant="ghost"
                  onClick={() =>
                    openTab({
                      kind: 'diff',
                      path,
                      from: status?.baseline?.sha ?? 'empty',
                      to: 'work',
                    })
                  }
                >
                  Ver diferenças
                </Button>
              )}
              {canEdit && fileChange.type === 'modify' && status?.baseline && (
                <Button
                  variant="danger"
                  onClick={() => restore.mutate({ sha: status.baseline?.sha ?? '', path })}
                >
                  Descartar
                </Button>
              )}
            </p>
          ) : (
            <p className="comment-empty">Sem alterações não salvas neste arquivo.</p>
          )}
          <ul className="history-list">
            {fileLog.length === 0 && (
              <li className="comment-empty">Nenhuma versão salva deste arquivo ainda.</li>
            )}
            {fileLog.map((e, i) => {
              const previous = fileLog[i + 1];
              return (
                <li key={e.sha}>
                  <div className="history-entry">
                    <span className="history-message">{e.message}</span>
                    <small>
                      {e.author.name} · {new Date(e.date).toLocaleString('pt-BR')}
                    </small>
                  </div>
                  <span className="history-compare">
                    <Button
                      variant="ghost"
                      onClick={() => openTab({ kind: 'diff', path, from: e.sha, to: 'work' })}
                    >
                      <GitCompare size={14} aria-hidden /> Comparar com atual
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={!previous}
                      onClick={() =>
                        previous && openTab({ kind: 'diff', path, from: previous.sha, to: e.sha })
                      }
                    >
                      Comparar com anterior
                    </Button>
                    <Button variant="ghost" onClick={() => view.mutate({ sha: e.sha, path })}>
                      ver
                    </Button>
                    {canEdit && (
                      <Button
                        variant="danger"
                        onClick={() => {
                          setRestoreTarget({ sha: e.sha, path });
                          restoreDialog.current?.showModal();
                        }}
                      >
                        restaurar
                      </Button>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}
      {error && <p className="form-error">{error.message}</p>}
      <Dialog
        ref={dialog}
        title={viewing?.path ?? 'Versão'}
        icon={<FileText size={18} aria-hidden="true" />}
        kicker="Conteúdo salvo"
        footer={
          <div className="actions">
            <Button variant="secondary" onClick={() => dialog.current?.close()}>
              Fechar
            </Button>
          </div>
        }
      >
        <pre className="history-pre">{viewing?.text}</pre>
      </Dialog>
      <Dialog
        ref={restoreDialog}
        title="Restaurar arquivo"
        icon={<RotateCcw size={18} aria-hidden="true" />}
        kicker={restoreTarget?.path ? <code>{restoreTarget.path}</code> : undefined}
        description="A versão atual deste arquivo será substituída pelo conteúdo salvo nesta versão. Essa ação não pode ser desfeita."
        tone="danger"
        pending={restore.isPending}
        footer={
          <div className="actions">
            <Button
              variant="ghost"
              onClick={() => restoreDialog.current?.close()}
              disabled={restore.isPending}
            >
              Cancelar
            </Button>
            <Button
              variant="danger"
              onClick={() => restoreTarget && restore.mutate(restoreTarget)}
              disabled={restore.isPending}
            >
              {restore.isPending ? 'Restaurando…' : 'Restaurar'}
            </Button>
          </div>
        }
      >
        {restore.error && <p className="form-error">{restore.error.message}</p>}
      </Dialog>
    </section>
  );
}
