import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Undo2 } from 'lucide-react';
import { type FormEvent, useRef, useState } from 'react';
import { useService } from '../../di/service-provider';
import { HistoryServiceToken } from '../../services/history.service';
import { useWorkspaceStore } from '../../workspace-store';
import { Button } from '../button';
import { Dialog } from '../dialog';

const letter = { add: 'A', modify: 'M', remove: 'D' } as const;

export function ChangesView({ projectId, canEdit }: { projectId: string; canEdit: boolean }) {
  const history = useService(HistoryServiceToken);
  const queryClient = useQueryClient();
  const setActivePath = useWorkspaceStore((s) => s.setActivePath);
  const openTab = useWorkspaceStore((s) => s.openTab);
  const [message, setMessage] = useState('');
  const discardDialog = useRef<HTMLDialogElement>(null);
  const [discardTarget, setDiscardTarget] = useState<string | null>(null);
  const { data } = useQuery({
    queryKey: ['history', projectId, 'status'],
    queryFn: () => history.status(projectId),
    refetchInterval: 30_000,
  });
  const baseline = data?.baseline;
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
    if (message.trim()) save.mutate();
  };
  return (
    <div className="changes-view">
      <p className="status-note">
        {baseline
          ? `Desde: ${baseline.message} · ${new Date(baseline.date).toLocaleString()}`
          : 'Sem versão salva'}
      </p>
      <ul className="change-list">
        {data?.changes.map((c) => (
          <li key={c.path}>
            <span className="change-badge" data-type={c.type}>
              {letter[c.type]}
            </span>
            {c.type === 'remove' ? (
              <span className="change-path">{c.path}</span>
            ) : (
              <button
                type="button"
                className="change-path"
                onClick={() =>
                  openTab({
                    kind: 'diff',
                    path: c.path,
                    from: baseline?.sha ?? 'empty',
                    to: 'work',
                  })
                }
              >
                {c.path}
              </button>
            )}
            {c.type !== 'remove' && (
              <Button
                variant="ghost"
                aria-label={`Abrir arquivo ${c.path}`}
                title="Abrir arquivo"
                onClick={() => setActivePath(c.path)}
              >
                <FileText size={14} aria-hidden />
              </Button>
            )}
            {canEdit && baseline && c.type === 'modify' && (
              <Button
                variant="ghost"
                aria-label={`Descartar alterações de ${c.path}`}
                title="Descartar"
                disabled={discard.isPending}
                onClick={() => {
                  setDiscardTarget(c.path);
                  discardDialog.current?.showModal();
                }}
              >
                <Undo2 size={14} aria-hidden />
              </Button>
            )}
          </li>
        ))}
      </ul>
      {canEdit && (
        <form className="change-form" onSubmit={submit}>
          <input
            placeholder="Mensagem da versão"
            aria-label="Mensagem da versão"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
          <Button variant="primary" type="submit" disabled={save.isPending || !message.trim()}>
            Salvar versão
          </Button>
          {save.error && <p className="form-error">{save.error.message}</p>}
        </form>
      )}
      <Dialog ref={discardDialog} title="Descartar alterações" pending={discard.isPending}>
        <p>Descartar alterações de "{discardTarget}"? Essa ação não pode ser desfeita.</p>
        {discard.error && <p className="form-error">{discard.error.message}</p>}
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
      </Dialog>
    </div>
  );
}
