import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { useService } from '../di/service-provider';
import { HistoryServiceToken } from '../services/history.service';
import { Button } from './button';
import { Dialog } from './dialog';

export function HistoryPanel({ projectId, canEdit }: { projectId: string; canEdit: boolean }) {
  const service = useService(HistoryServiceToken);
  const queryClient = useQueryClient();
  const dialog = useRef<HTMLDialogElement>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [viewing, setViewing] = useState<{ path: string; text: string } | null>(null);
  const { data: log = [] } = useQuery({
    queryKey: ['history', projectId],
    queryFn: () => service.log(projectId, 50),
  });
  // Changes are shown against the previous commit in the list (the log is newest first).
  const index = log.findIndex((e) => e.sha === selected);
  const parent = log[index + 1];
  const { data: changes = [] } = useQuery({
    queryKey: ['history', projectId, 'changes', selected, parent?.sha],
    queryFn: () => service.changes(projectId, parent?.sha ?? '', selected ?? ''),
    enabled: selected !== null && parent !== undefined,
  });
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['files', projectId] }),
      queryClient.invalidateQueries({ queryKey: ['history', projectId] }),
    ]);
  const save = useMutation({
    mutationFn: (message: string) => service.commit(projectId, message),
    onSuccess: refresh,
  });
  const restore = useMutation({
    mutationFn: ({ sha, path }: { sha: string; path: string }) =>
      service.restore(projectId, sha, path),
    onSuccess: refresh,
  });
  const view = useMutation({
    mutationFn: async (path: string) => ({
      path,
      text: await service.file(projectId, selected ?? '', path),
    }),
    onSuccess: (v) => {
      setViewing(v);
      dialog.current?.showModal();
    },
  });

  const saveVersion = () => {
    const message = prompt('Mensagem da versão')?.trim();
    if (message) save.mutate(message);
  };
  const error = save.error ?? restore.error ?? view.error;

  return (
    <section className="history-panel" aria-label="Histórico">
      {canEdit && (
        <Button variant="secondary" disabled={save.isPending} onClick={saveVersion}>
          Salvar versão
        </Button>
      )}
      <ul className="history-list">
        {log.map((e) => (
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
            {e.sha === selected && (
              <ul className="history-changes">
                {!parent && <li className="comment-empty">Primeira versão.</li>}
                {changes.map((c) => (
                  <li key={c.path}>
                    <code>
                      {c.type} {c.path}
                    </code>
                    {c.type !== 'remove' && (
                      <Button variant="ghost" onClick={() => view.mutate(c.path)}>
                        ver
                      </Button>
                    )}
                    {canEdit && (
                      <Button
                        variant="ghost"
                        onClick={() => {
                          if (confirm(`Restaurar ${c.path} para esta versão?`))
                            restore.mutate({ sha: e.sha, path: c.path });
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
      {error && <p className="form-error">{error.message}</p>}
      <Dialog ref={dialog} title={viewing?.path ?? 'Versão'}>
        <pre className="history-pre">{viewing?.text}</pre>
        <Button variant="secondary" onClick={() => dialog.current?.close()}>
          Fechar
        </Button>
      </Dialog>
    </section>
  );
}
