import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useService } from '../di/service-provider';
import { CompileServiceToken, isActive, type LogEntry } from '../services/compile.service';
import { useWorkspaceStore } from '../workspace-store';
import { Button } from './button';
import { useBuilds } from './use-builds';

const statusText = {
  queued: 'Na fila…',
  running: 'Compilando…',
  succeeded: 'Compilado com sucesso',
  failed: 'Falhou',
  timeout: 'Tempo esgotado',
};

export function BuildPanel({ projectId, canCompile }: { projectId: string; canCompile: boolean }) {
  const compile = useService(CompileServiceToken);
  const queryClient = useQueryClient();
  const { data: builds } = useBuilds(projectId);
  const build = builds?.[0];
  const start = useMutation({
    mutationFn: () => compile.compile(projectId),
    onSuccess: (b) => queryClient.setQueryData(['builds', projectId], [b, ...(builds ?? [])]),
  });

  return (
    <section className="build-panel" aria-label="Compilação">
      <div className="build-head">
        <Button
          variant="primary"
          disabled={!canCompile || start.isPending || isActive(build)}
          onClick={() => start.mutate()}
        >
          Compilar
        </Button>
        {build && (
          <span className="build-status" data-status={build.status}>
            {statusText[build.status]}
          </span>
        )}
        {build && (
          <a href={compile.logUrl(projectId, build.id)} target="_blank" rel="noreferrer">
            ver log
          </a>
        )}
      </div>
      {start.error && <p className="form-error">{start.error.message}</p>}
      {build && (
        <ul className="log-list">
          {build.errors.map((e) => (
            <LogItem key={logKey('error', e)} kind="error" entry={e} />
          ))}
          {build.warnings.map((w) => (
            <LogItem key={logKey('warning', w)} kind="warning" entry={w} />
          ))}
        </ul>
      )}
    </section>
  );
}

function LogItem({ kind, entry }: { kind: 'error' | 'warning'; entry: LogEntry }) {
  const goToLine = useWorkspaceStore((s) => s.goToLine);
  const setActivePath = useWorkspaceStore((s) => s.setActivePath);
  const file = entry.file?.replace(/^\.\//, '');
  const go = () => {
    if (!file) return;
    if (entry.line) goToLine(file, entry.line);
    else setActivePath(file);
  };
  return (
    <li className={`log-item log-${kind}`}>
      {file && (
        <button type="button" onClick={go}>
          {file}
          {entry.line ? `:${entry.line}` : ''}
        </button>
      )}
      <span>{entry.message}</span>
    </li>
  );
}

const logKey = (kind: string, e: LogEntry) => `${kind}|${e.file}|${e.line}|${e.message}`;
