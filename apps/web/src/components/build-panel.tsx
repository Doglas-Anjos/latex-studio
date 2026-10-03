import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useService } from '../di/service-provider';
import { CompileServiceToken, isActive, type LogEntry } from '../services/compile.service';
import { ProjectServiceToken } from '../services/project.service';
import {
  type ExportFormat,
  type JobStatus,
  ToolsServiceToken,
  type WordCount,
} from '../services/tools.service';
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const exportLabels: [ExportFormat, string][] = [
  ['docx', 'DOCX'],
  ['md', 'Markdown'],
  ['html', 'HTML'],
];

export function BuildPanel({ projectId, canCompile }: { projectId: string; canCompile: boolean }) {
  const compile = useService(CompileServiceToken);
  const projects = useService(ProjectServiceToken);
  const tools = useService(ToolsServiceToken);
  const queryClient = useQueryClient();
  const { data: builds } = useBuilds(projectId);
  const build = builds?.[0];
  const start = useMutation({
    mutationFn: () => compile.compile(projectId),
    onSuccess: (b) => queryClient.setQueryData(['builds', projectId], [b, ...(builds ?? [])]),
  });

  // Polls the tools job until it ends; a failed job becomes the mutation error.
  const waitFor = async <T,>(jobId: string): Promise<T | undefined> => {
    for (;;) {
      await sleep(1500);
      const job: JobStatus<T> = await tools.jobStatus<T>(projectId, jobId);
      if (job.state === 'completed') return job.result;
      if (job.state === 'failed') throw new Error(job.error || 'Falhou');
    }
  };
  const exportAs = useMutation({
    mutationFn: async (format: ExportFormat) => {
      const { jobId } = await tools.requestExport(projectId, format);
      await waitFor(jobId);
      window.location.assign(tools.jobFileUrl(projectId, jobId));
    },
  });
  const count = useMutation({
    mutationFn: async () => {
      const { jobId } = await tools.wordCount(projectId);
      const r = await waitFor<WordCount>(jobId);
      return r?.words === undefined
        ? (r?.raw ?? '')
        : `${r.words} palavras · ${r.headers} em títulos · ${r.captions} em legendas`;
    },
  });
  const busy = exportAs.isPending || count.isPending;

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
        <details className="menu">
          <summary>Baixar</summary>
          <a href={projects.sourceZipUrl(projectId)} download>
            Fonte (.zip)
          </a>
          <a href={projects.sourceZipUrl(projectId, true)} download>
            Fonte com histórico git (.zip)
          </a>
          {exportLabels.map(([format, label]) => (
            <button
              key={format}
              type="button"
              disabled={busy}
              onClick={() => exportAs.mutate(format)}
            >
              {label}
            </button>
          ))}
          <button type="button" disabled={busy} onClick={() => count.mutate()}>
            Contar palavras
          </button>
          {build?.status === 'succeeded' && (
            <a href={compile.pdfUrl(projectId, build.id)} download>
              PDF
            </a>
          )}
        </details>
      </div>
      {start.error && <p className="form-error">{start.error.message}</p>}
      {exportAs.error && <p className="form-error">{exportAs.error.message}</p>}
      {count.error && <p className="form-error">{count.error.message}</p>}
      {busy && <p className="status-note">Processando…</p>}
      {count.data && <p className="status-note">{count.data}</p>}
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
