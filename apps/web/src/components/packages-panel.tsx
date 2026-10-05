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

export function PackagesPanel({ projectId, canEdit }: { projectId: string; canEdit: boolean }) {
  const service = useService(PackageServiceToken);
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [search, setSearch] = useState('');
  const [moved, setMoved] = useState<number | null>(null);
  const { data } = useQuery({
    queryKey: ['packages', projectId],
    queryFn: () => service.get(projectId),
  });
  const { data: usage } = useQuery({
    queryKey: ['packages', projectId, 'usage'],
    queryFn: () => service.usage(projectId),
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
  const busy = save.isPending || migrate.isPending;
  const error = save.error ?? migrate.error;

  const normalizedSearch = search.trim().toLowerCase();
  const matches = (n: string) => !normalizedSearch || n.toLowerCase().includes(normalizedSearch);
  const visibleList = list.map((e, i) => ({ e, i })).filter(({ e }) => matches(e.name));
  const visibleDetected = detected.filter((u) => matches(u.name));
  const enabledCount = list.filter((e) => e.enabled).length;
  const disabledCount = list.length - enabledCount;

  return (
    <section className="packages-panel" aria-label="Bibliotecas">
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
        <Button variant="secondary" size="compact" type="submit" disabled={busy || !name.trim()}>
          Adicionar
        </Button>
      </form>
      {(list.length > 0 || detected.length > 0) && (
        <div className="packages-overview">
          <span className="packages-stat">
            <strong>{list.length}</strong> {list.length === 1 ? 'pacote' : 'pacotes'}
          </span>
          {enabledCount > 0 && (
            <span className="packages-stat packages-stat-ok">
              <strong>{enabledCount}</strong> ativos
            </span>
          )}
          {disabledCount > 0 && (
            <span className="packages-stat packages-stat-off">
              <strong>{disabledCount}</strong> desativados
            </span>
          )}
          {detected.length > 0 && (
            <span className="packages-stat packages-stat-detected">
              <strong>{detected.length}</strong> detectados
            </span>
          )}
        </div>
      )}
      {(list.length > 3 || detected.length > 3) && (
        <div className="packages-search">
          <Search size={14} aria-hidden="true" className="packages-search-icon" />
          <input
            type="search"
            aria-label="Buscar pacotes"
            placeholder="Buscar pacotes"
            value={search}
            onChange={(ev) => setSearch(ev.target.value)}
          />
        </div>
      )}
      <ul className="package-list">
        {visibleList.map(({ e, i }) => (
          <li key={e.name} className="package-item" data-enabled={e.enabled}>
            <div className="package-row">
              <label className="package-name">
                <input
                  type="checkbox"
                  className="package-switch"
                  checked={e.enabled}
                  disabled={!canEdit || busy}
                  onChange={(ev) => patch(i, { enabled: ev.target.checked })}
                />
                <span className="package-name-text">{e.name}</span>
              </label>
              {!e.enabled && usedBy(e.name).length > 0 && (
                <span className="badge">bypass ativo</span>
              )}
            </div>
            <div className="package-meta">
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
              {usedBy(e.name).length > 0 && (
                <small className="package-usage" title={usageText(e.name)}>
                  {usageText(e.name)}
                </small>
              )}
              {canEdit && (
                <span className="package-actions">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Subir ${e.name}`}
                    disabled={busy || i === 0}
                    onClick={() => move(i, -1)}
                  >
                    <ChevronUp size={14} aria-hidden="true" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Descer ${e.name}`}
                    disabled={busy || i === list.length - 1}
                    onClick={() => move(i, 1)}
                  >
                    <ChevronDown size={14} aria-hidden="true" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Remover ${e.name}`}
                    disabled={busy}
                    onClick={() => commit(list.filter((_, j) => j !== i))}
                  >
                    <Trash2 size={14} aria-hidden="true" />
                  </Button>
                </span>
              )}
            </div>
          </li>
        ))}
      </ul>
      {list.length > 0 && visibleList.length === 0 && (
        <p className="muted">Nenhum pacote corresponde à busca.</p>
      )}
      {detected.length > 0 && visibleDetected.length > 0 && (
        <details className="package-detected" open>
          <summary>
            Detectados no código <span className="badge">{visibleDetected.length}</span>
          </summary>
          <ul className="detected-list">
            {visibleDetected.map((u) => (
              <li key={u.name} className="package-item">
                <div className="package-row">
                  <span className="package-name-text">{u.name}</span>
                  {canEdit && (
                    <span className="package-actions">
                      <Button
                        variant="ghost"
                        size="compact"
                        title={`Desligar ${u.name} sem adicioná-lo ao gerenciador`}
                        disabled={busy}
                        onClick={() => addDetected(u, false)}
                      >
                        Desligar
                      </Button>
                      <Button
                        variant="ghost"
                        size="compact"
                        title={`Mover ${u.name} para o gerenciador de pacotes`}
                        disabled={busy}
                        onClick={() => addDetected(u, true)}
                      >
                        Mover
                      </Button>
                    </span>
                  )}
                </div>
                <small className="package-usage" title={usageText(u.name)}>
                  {usageText(u.name)}
                </small>
              </li>
            ))}
          </ul>
        </details>
      )}
      {canEdit && (
        <Button variant="secondary" size="compact" disabled={busy} onClick={() => migrate.mutate()}>
          Mover \usepackage do arquivo principal
        </Button>
      )}
      <p className="package-note">Desligar um pacote do qual outro depende quebra a compilação.</p>
      {moved !== null && <p className="package-note">{moved} pacotes movidos.</p>}
      {error && <p className="form-error">{error.message}</p>}
    </section>
  );
}
