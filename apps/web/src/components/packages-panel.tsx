import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronUp, Search, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useService } from '../di/service-provider';
import { LATEX_CATALOG } from '../latex-catalog';
import {
  type PackageEntry,
  PackageServiceToken,
  type PackageUsage,
} from '../services/package.service';
import { Button } from './button';

type Filter = 'all' | 'on' | 'off' | 'detected';

export function PackagesPanel({ projectId, canEdit }: { projectId: string; canEdit: boolean }) {
  const service = useService(PackageServiceToken);
  const queryClient = useQueryClient();
  const manifestKey = ['packages', projectId];
  const [name, setName] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [moved, setMoved] = useState<number | null>(null);
  const { data } = useQuery({ queryKey: manifestKey, queryFn: () => service.get(projectId) });
  const { data: usage } = useQuery({
    queryKey: ['packages', projectId, 'usage'],
    queryFn: () => service.usage(projectId),
  });
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: manifestKey }),
      queryClient.invalidateQueries({ queryKey: ['files', projectId] }),
    ]);
  // Optimistic: the switch flips at once and nothing else on the panel is disabled while the
  // server writes the manifest; a failure rolls back and shows the error.
  const save = useMutation({
    mutationFn: (next: PackageEntry[]) => service.set(projectId, next),
    onMutate: async (next) => {
      await queryClient.cancelQueries({ queryKey: manifestKey, exact: true });
      const previous = queryClient.getQueryData<PackageEntry[]>(manifestKey);
      queryClient.setQueryData(manifestKey, next);
      return { previous };
    },
    onError: (_e, _next, ctx) => queryClient.setQueryData(manifestKey, ctx?.previous),
    onSettled: refresh,
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
  const usedBy = (n: string) => (usage ?? []).filter((u) => u.name === n);
  const usageText = (n: string) =>
    usedBy(n)
      .map((u) => `${u.path}:${u.line}`)
      .join(', ');
  const detected = [
    ...new Map(
      (usage ?? []).filter((u) => !list.some((e) => e.name === u.name)).map((u) => [u.name, u]),
    ).values(),
  ];
  const addDetected = (u: PackageUsage, enabled: boolean) =>
    commit([
      ...list,
      { name: u.name, ...(u.options ? { options: u.options } : {}), enabled, order: list.length },
    ]);

  const q = search.trim().toLowerCase();
  const matches = (n: string) => !q || n.toLowerCase().includes(q);
  const visibleList = list
    .map((e, i) => ({ e, i }))
    .filter(({ e }) => matches(e.name))
    .filter(
      ({ e }) => filter === 'all' || (filter === 'on' ? e.enabled : filter === 'off' && !e.enabled),
    );
  const visibleDetected =
    filter === 'all' || filter === 'detected' ? detected.filter((u) => matches(u.name)) : [];
  const onCount = list.filter((e) => e.enabled).length;
  const chips: { key: Filter; label: string; count: number }[] = [
    { key: 'all', label: 'Todos', count: list.length + detected.length },
    { key: 'on', label: 'Ativos', count: onCount },
    { key: 'off', label: 'Desligados', count: list.length - onCount },
    { key: 'detected', label: 'Detectados', count: detected.length },
  ];
  const error = save.error ?? migrate.error;

  return (
    <section className="pkg" aria-label="Bibliotecas">
      {canEdit && (
        <form
          className="pkg-add"
          onSubmit={(ev) => {
            ev.preventDefault();
            add();
          }}
        >
          <input
            list="package-catalog"
            aria-label="Adicionar pacote"
            placeholder="Adicionar pacote do TeX Live"
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
          <Button variant="secondary" size="compact" type="submit" disabled={!name.trim()}>
            Adicionar
          </Button>
        </form>
      )}

      <fieldset className="pkg-filters">
        <legend className="sr-only">Filtrar pacotes</legend>
        {chips.map((c) => (
          <button
            key={c.key}
            type="button"
            className="pkg-chip"
            data-kind={c.key}
            aria-pressed={filter === c.key}
            onClick={() => setFilter(c.key)}
          >
            {c.label} <strong>{c.count}</strong>
          </button>
        ))}
      </fieldset>

      {list.length + detected.length > 5 && (
        <label className="pkg-search">
          <Search size={14} aria-hidden="true" />
          <input
            type="search"
            aria-label="Buscar pacotes"
            placeholder="Buscar pacotes"
            value={search}
            onChange={(ev) => setSearch(ev.target.value)}
          />
        </label>
      )}

      {visibleList.length > 0 && (
        <ul className="pkg-list">
          {visibleList.map(({ e, i }) => (
            <li key={e.name} className="pkg-item" data-enabled={e.enabled}>
              <div className="pkg-line">
                <button
                  type="button"
                  role="switch"
                  className="pkg-switch"
                  aria-checked={e.enabled}
                  aria-label={`${e.enabled ? 'Desligar' : 'Ligar'} ${e.name}`}
                  title={e.enabled ? 'Ativo: clique para desligar' : 'Desligado: clique para ligar'}
                  disabled={!canEdit}
                  onClick={() => patch(i, { enabled: !e.enabled })}
                />
                <span className="pkg-name" title={e.name}>
                  {e.name}
                </span>
                {!e.enabled && usedBy(e.name).length > 0 && (
                  <span className="pkg-badge" title="Ainda está no código: o LaTeX pula a linha">
                    bypass
                  </span>
                )}
                {canEdit && (
                  <span className="pkg-actions">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Subir ${e.name}`}
                      disabled={i === 0}
                      onClick={() => move(i, -1)}
                    >
                      <ChevronUp size={14} aria-hidden="true" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Descer ${e.name}`}
                      disabled={i === list.length - 1}
                      onClick={() => move(i, 1)}
                    >
                      <ChevronDown size={14} aria-hidden="true" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Remover ${e.name}`}
                      onClick={() => commit(list.filter((_, j) => j !== i))}
                    >
                      <Trash2 size={14} aria-hidden="true" />
                    </Button>
                  </span>
                )}
              </div>
              <div className="pkg-line pkg-sub">
                <input
                  className="pkg-options"
                  aria-label={`Opções de ${e.name}`}
                  placeholder="opções"
                  defaultValue={e.options ?? ''}
                  disabled={!canEdit}
                  maxLength={200}
                  onBlur={(ev) => {
                    const options = ev.target.value.trim();
                    if (options !== (e.options ?? '')) patch(i, { options });
                  }}
                />
                {usedBy(e.name).length > 0 && (
                  <small className="pkg-usage" title={usageText(e.name)}>
                    {usageText(e.name)}
                  </small>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {visibleDetected.length > 0 && (
        <section className="pkg-detected" aria-label="Detectados no código">
          <h3>
            Detectados no código <span className="pkg-count">{visibleDetected.length}</span>
          </h3>
          <ul className="pkg-list">
            {visibleDetected.map((u) => (
              <li key={u.name} className="pkg-item" data-detected>
                <div className="pkg-line">
                  <span className="pkg-name" title={u.name}>
                    {u.name}
                  </span>
                  {canEdit && (
                    <span className="pkg-actions">
                      <Button
                        variant="ghost"
                        size="compact"
                        title={`Desligar ${u.name} sem mexer no código`}
                        onClick={() => addDetected(u, false)}
                      >
                        Desligar
                      </Button>
                      <Button
                        variant="ghost"
                        size="compact"
                        title={`Passar ${u.name} para o gerenciador`}
                        onClick={() => addDetected(u, true)}
                      >
                        Mover
                      </Button>
                    </span>
                  )}
                </div>
                <small className="pkg-usage" title={usageText(u.name)}>
                  {usageText(u.name)}
                </small>
              </li>
            ))}
          </ul>
        </section>
      )}

      {visibleList.length === 0 && visibleDetected.length === 0 && (
        <p className="muted">Nenhum pacote neste filtro.</p>
      )}
      {canEdit && (
        <Button
          variant="secondary"
          size="compact"
          disabled={migrate.isPending}
          onClick={() => migrate.mutate()}
        >
          Mover \usepackage do arquivo principal
        </Button>
      )}
      <p className="pkg-note">Desligar um pacote do qual outro depende quebra a compilação.</p>
      {moved !== null && <p className="pkg-note">{moved} pacotes movidos.</p>}
      {error && <p className="form-error">{error.message}</p>}
    </section>
  );
}
