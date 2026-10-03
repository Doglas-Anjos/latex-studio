import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useService } from '../di/service-provider';
import { LATEX_CATALOG } from '../latex-catalog';
import { type PackageEntry, PackageServiceToken } from '../services/package.service';
import { Button } from './button';

export function PackagesPanel({ projectId, canEdit }: { projectId: string; canEdit: boolean }) {
  const service = useService(PackageServiceToken);
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [moved, setMoved] = useState<number | null>(null);
  const { data } = useQuery({
    queryKey: ['packages', projectId],
    queryFn: () => service.get(projectId),
  });
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['packages', projectId] }),
      queryClient.invalidateQueries({ queryKey: ['files', projectId] }),
    ]);
  const save = useMutation({
    mutationFn: (next: PackageEntry[]) => service.set(projectId, next),
    onSuccess: refresh,
  });
  const migrate = useMutation({
    mutationFn: () => service.migrate(projectId),
    onSuccess: (r) => {
      setMoved(r.moved);
      return refresh();
    },
  });

  const list = [...(data ?? [])].sort((a, b) => a.order - b.order);
  const commit = (next: PackageEntry[]) => save.mutate(next.map((e, order) => ({ ...e, order })));
  const patch = (i: number, change: Partial<PackageEntry>) =>
    commit(list.map((e, j) => (j === i ? { ...e, ...change } : e)));
  const move = (i: number, by: number) => {
    const next = [...list];
    const [item] = next.splice(i, 1);
    if (item) next.splice(i + by, 0, item);
    commit(next);
  };
  const add = () => {
    const n = name.trim();
    if (!n || list.some((e) => e.name === n)) return;
    commit([...list, { name: n, enabled: true, order: list.length }]);
    setName('');
  };
  const busy = save.isPending || migrate.isPending;
  const error = save.error ?? migrate.error;

  return (
    <section className="packages-panel" aria-label="Bibliotecas">
      <ul className="package-list">
        {list.map((e, i) => (
          <li key={e.name} className="package-item">
            <label className="package-name">
              <input
                type="checkbox"
                checked={e.enabled}
                disabled={!canEdit || busy}
                onChange={(ev) => patch(i, { enabled: ev.target.checked })}
              />
              {e.name}
            </label>
            <input
              className="package-options"
              aria-label={`Opções de ${e.name}`}
              placeholder="opções"
              defaultValue={e.options ?? ''}
              disabled={!canEdit || busy}
              maxLength={200}
              onBlur={(ev) => {
                const options = ev.target.value.trim();
                if (options !== (e.options ?? '')) patch(i, { options });
              }}
            />
            {canEdit && (
              <span className="package-actions">
                <Button
                  variant="ghost"
                  aria-label={`Subir ${e.name}`}
                  disabled={busy || i === 0}
                  onClick={() => move(i, -1)}
                >
                  ↑
                </Button>
                <Button
                  variant="ghost"
                  aria-label={`Descer ${e.name}`}
                  disabled={busy || i === list.length - 1}
                  onClick={() => move(i, 1)}
                >
                  ↓
                </Button>
                <Button
                  variant="ghost"
                  aria-label={`Remover ${e.name}`}
                  disabled={busy}
                  onClick={() => commit(list.filter((_, j) => j !== i))}
                >
                  ×
                </Button>
              </span>
            )}
          </li>
        ))}
      </ul>
      {canEdit && (
        <>
          <form
            className="package-add"
            onSubmit={(ev) => {
              ev.preventDefault();
              add();
            }}
          >
            <input
              list="package-catalog"
              aria-label="Adicionar pacote"
              placeholder="Adicionar pacote"
              value={name}
              onChange={(ev) => setName(ev.target.value)}
            />
            <datalist id="package-catalog">
              {LATEX_CATALOG.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.description}
                </option>
              ))}
            </datalist>
            <Button variant="secondary" type="submit" disabled={busy || !name.trim()}>
              Adicionar
            </Button>
          </form>
          <Button variant="secondary" disabled={busy} onClick={() => migrate.mutate()}>
            Mover \usepackage do arquivo principal
          </Button>
        </>
      )}
      {moved !== null && (
        <p className="package-note">
          {moved} pacotes movidos.{' '}
          {moved > 0 && 'Recarregue o arquivo principal para ver a mudança.'}
        </p>
      )}
      {error && <p className="form-error">{error.message}</p>}
    </section>
  );
}
