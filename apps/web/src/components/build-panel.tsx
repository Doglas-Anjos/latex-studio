import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  ChevronDown,
  ChevronUp,
  CircleCheck,
  CircleX,
  Download,
  FileDown,
  FileText,
  GitBranch,
  Hash,
  Loader2,
  TriangleAlert,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useService } from '../di/service-provider';
import {
  type Build,
  CompileServiceToken,
  isActive,
  isStale,
  type LogEntry,
} from '../services/compile.service';
import { FileServiceToken } from '../services/file.service';
import { PackageServiceToken } from '../services/package.service';
import { type Project, ProjectServiceToken } from '../services/project.service';
import { type ExportFormat, ToolsServiceToken, type WordCount } from '../services/tools.service';
import { useSettingsStore } from '../settings-store';
import { useWorkspaceStore } from '../workspace-store';
import { Button } from './button';
import { Dialog } from './dialog';
import { useBuilds } from './use-builds';
import { waitForJob } from './use-tools-job';

const statusText = {
  queued: 'Na fila…',
  running: 'Compilando…',
  succeeded: 'Compilado com sucesso',
  failed: 'Falhou',
  timeout: 'Tempo esgotado',
};

const statusIcons: Record<Build['status'], typeof CircleCheck> = {
  queued: Loader2,
  running: Loader2,
  succeeded: CircleCheck,
  failed: CircleX,
  timeout: CircleX,
};

const exportLabels: [ExportFormat, string][] = [
  ['docx', 'DOCX'],
  ['md', 'Markdown'],
  ['html', 'HTML'],
];

const engineLabels: Record<Project['engine'], string> = {
  pdflatex: 'pdfLaTeX',
  xelatex: 'XeLaTeX',
  lualatex: 'LuaLaTeX',
};

/**
 * Why a build that ended badly lists no error, or `null` when there is nothing to explain. Some
 * real failures leave the log parser with nothing to extract (a font the installation lacks, an
 * engine that cannot handle the sources, a crash before the first LaTeX error), and the faithful
 * "0 erros" would otherwise read as a clean compile.
 */
function unexplainedFailure(build: Build): string | null {
  if (build.status !== 'failed' && build.status !== 'timeout') return null;
  if (build.errors.length > 0) return null;
  const code = build.exitCode === null ? '' : ` (código de saída ${build.exitCode})`;
  return `${statusText[build.status]}${code}`;
}

const elapsedSeconds = (build: Build) =>
  Math.max(
    0,
    Math.round((Date.now() - new Date(build.startedAt ?? build.createdAt).getTime()) / 1000),
  );

/**
 * Re-renders once a second while `on`. The polled build object does not change while a job is
 * queued or running, so every clock-derived label (elapsed seconds, and the switch to a retry
 * once the build looks orphaned) would otherwise stay frozen at the value of the last render.
 * Nothing is scheduled while `on` is false, and the interval is cleared on unmount.
 */
function useSecondTick(on: boolean) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!on) return;
    const id = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [on]);
}

export function BuildPanel({ projectId, canCompile }: { projectId: string; canCompile: boolean }) {
  const compile = useService(CompileServiceToken);
  const projects = useService(ProjectServiceToken);
  const tools = useService(ToolsServiceToken);
  const files = useService(FileServiceToken);
  const queryClient = useQueryClient();
  const { data: builds } = useBuilds(projectId);
  const packages = useService(PackageServiceToken);
  const { data: manifest } = useQuery({
    queryKey: ['packages', projectId],
    queryFn: () => packages.get(projectId),
  });
  const { data: usage } = useQuery({
    queryKey: ['packages', projectId, 'usage'],
    queryFn: () => packages.usage(projectId),
  });
  const disabledUsed = manifest?.find(
    (e) => !e.enabled && usage?.some((u) => u.name === e.name),
  )?.name;
  const build = builds?.[0];
  useSecondTick(isActive(build));
  const open = useSettingsStore((s) => s.panelOpen);
  const setSettings = useSettingsStore((s) => s.set);
  const showPanel = () => setSettings({ panelOpen: true });
  // Problems filter: a count badge toggles its kind; clicking the active one shows everything.
  const [filter, setFilter] = useState<Kind | 'all'>('all');
  const pick = (kind: Kind) => {
    setFilter(filter === kind ? 'all' : kind);
    showPanel();
  };
  const nErrors = build?.errors.length ?? 0;
  const nWarnings = build?.warnings.length ?? 0;
  const failureNote = build ? unexplainedFailure(build) : null;
  const groups = build ? groupByFile(build, filter) : [];
  const start = useMutation({
    mutationFn: () => compile.compile(projectId),
    onSuccess: (b) => queryClient.setQueryData(['builds', projectId], [b, ...(builds ?? [])]),
    onError: showPanel,
  });
  const { data: project } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => projects.get(projectId),
  });
  const setEngine = useMutation({
    mutationFn: (engine: Project['engine']) => projects.update(projectId, { engine }),
    // ProjectPage reads permissions off this cache entry, so the saved project is merged onto it:
    // overwriting it with a response that carries no role would revoke editing until a refetch.
    onSuccess: (p) =>
      queryClient.setQueryData<Project>(['project', projectId], (prev) =>
        prev ? { ...prev, ...p, role: p.role ?? prev.role } : undefined,
      ),
    onError: showPanel,
  });
  // The API re-validates and fails a stale build for real before accepting this retry; this only
  // decides when to stop blocking the button on a build that looks orphaned.
  const stuck = isStale(build);
  const engineUnconfirmed = !project || setEngine.isPending;
  // The most recent build may target an engine the project no longer uses (the user switched it
  // after that build started). A running build like that never blocks a new one: the API queues
  // the new engine behind it. A queued one does block, because the API rejects it with a 409
  // instead of silently retargeting or stacking it — so the honest reason is "already queued for
  // the old engine", not "compiling".
  const engineChanged = !!build && !!project && build.engine !== project.engine;
  const queuedConflict = build?.status === 'queued' && engineChanged;
  const compileDisabled =
    !canCompile ||
    start.isPending ||
    engineUnconfirmed ||
    (isActive(build) && !stuck && (!engineChanged || queuedConflict));
  const compileTitle = !canCompile
    ? 'Você não tem permissão para compilar este projeto'
    : engineUnconfirmed
      ? 'Aguarde: salvando o motor LaTeX escolhido'
      : stuck && build
        ? `Sem resposta há ${elapsedSeconds(build)}s; clique para tentar novamente`
        : queuedConflict && build
          ? `Uma compilação com ${engineLabels[build.engine as Project['engine']]} já está na fila; aguarde terminar para compilar com ${engineLabels[project?.engine ?? 'pdflatex']}`
          : build && isActive(build) && !engineChanged
            ? `Aguarde: ${statusText[build.status]} (${elapsedSeconds(build)}s)`
            : undefined;

  const waitFor = <T,>(jobId: string) => waitForJob<T>(tools, projectId, jobId);
  const [formatProgress, setFormatProgress] = useState('');
  // Every .tex through latexindent: the open file via the editor (keeps cursors), others via PUT.
  const formatAll = useMutation({
    mutationFn: async () => {
      const paths = (await files.list(projectId))
        .map((f) => f.path)
        .filter((p) => /\.tex$/i.test(p));
      let skipped = 0;
      for (const [i, path] of paths.entries()) {
        setFormatProgress(`Formatando ${i + 1}/${paths.length}…`);
        const { activePath, editorCommands } = useWorkspaceStore.getState();
        const live = editorCommands && path === (activePath ?? paths[0]) ? editorCommands : null;
        const read = async () =>
          live ? live.getText() : (await files.blob(projectId, path)).text();
        const before = await read();
        const { jobId } = await tools.format(projectId, path, before);
        const r = await waitFor<{ text: string }>(jobId);
        // Edited meanwhile (here or by a collaborator): skip rather than revert their change.
        if (!r || (await read()) !== before) {
          skipped++;
          continue;
        }
        if (live) live.applyText(r.text);
        else await files.write(projectId, path, r.text);
      }
      if (skipped) {
        throw new Error(`${skipped} arquivo(s) mudaram durante a formatação e não foram tocados`);
      }
    },
    onSettled: () => {
      setFormatProgress('');
      queryClient.invalidateQueries({ queryKey: ['files', projectId] });
      queryClient.invalidateQueries({ queryKey: ['history', projectId] });
    },
  });
  const exportAs = useMutation({
    mutationFn: async (format: ExportFormat) => {
      const { jobId } = await tools.requestExport(projectId, format);
      await waitFor(jobId);
      await tools.downloadJobFile(projectId, jobId, `project.${format}`);
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
  const busy = exportAs.isPending || count.isPending || formatAll.isPending;
  const downloadRef = useRef<HTMLDialogElement>(null);
  const withClose = (action: () => void) => () => {
    action();
    downloadRef.current?.close();
  };
  const ToggleIcon = open ? ChevronDown : ChevronUp;
  const toggleLabel = open ? 'Ocultar logs' : 'Mostrar logs';

  const StatusIcon = stuck ? TriangleAlert : build ? statusIcons[build.status] : null;
  const statusSpinning = !stuck && isActive(build);

  return (
    <section className="build-panel" aria-label="Compilação">
      <div className="build-bar">
        <Button
          variant="primary"
          size="compact"
          disabled={compileDisabled}
          title={compileTitle}
          onClick={() => start.mutate()}
        >
          {stuck ? 'Tentar novamente' : 'Compilar'}
        </Button>
        <select
          className="engine-select"
          aria-label="Motor LaTeX"
          title="Motor LaTeX (fontspec e polyglossia exigem XeLaTeX ou LuaLaTeX)"
          value={project?.engine ?? 'pdflatex'}
          disabled={!canCompile || !project || setEngine.isPending}
          onChange={(e) => setEngine.mutate(e.target.value as Project['engine'])}
        >
          <option value="pdflatex">pdfLaTeX</option>
          <option value="xelatex">XeLaTeX</option>
          <option value="lualatex">LuaLaTeX</option>
        </select>
        {build && (
          <span className="build-status" data-status={build.status} data-stuck={stuck}>
            {StatusIcon && (
              <StatusIcon
                size={14}
                aria-hidden="true"
                className={statusSpinning ? 'build-status-spin' : undefined}
              />
            )}
            {stuck
              ? `Sem resposta há ${elapsedSeconds(build)}s`
              : isActive(build)
                ? `${statusText[build.status]} (${elapsedSeconds(build)}s)`
                : statusText[build.status]}
          </span>
        )}
        {queuedConflict && build && (
          <span className="status-note-inline engine-conflict-note" role="status">
            fila com {engineLabels[build.engine as Project['engine']]}; aguarda para{' '}
            {engineLabels[project?.engine ?? 'pdflatex']}
          </span>
        )}
        {build && !isActive(build) && (
          <fieldset className="problem-counts">
            <legend className="sr-only">Problemas da compilação</legend>
            <button
              type="button"
              className="problem-count"
              data-kind="error"
              aria-pressed={filter === 'error'}
              disabled={nErrors === 0}
              onClick={() => pick('error')}
            >
              <CircleX size={14} aria-hidden="true" />
              {nErrors} {nErrors === 1 ? 'erro' : 'erros'}
            </button>
            <button
              type="button"
              className="problem-count"
              data-kind="warning"
              aria-pressed={filter === 'warning'}
              disabled={nWarnings === 0}
              onClick={() => pick('warning')}
            >
              <TriangleAlert size={14} aria-hidden="true" />
              {nWarnings} {nWarnings === 1 ? 'aviso' : 'avisos'}
            </button>
            {/* Only a build that actually succeeded earns the green badge: on a failure the two
                zeroed counts stay as they are, and the details panel explains them. */}
            {build.status === 'succeeded' && nErrors === 0 && nWarnings === 0 && (
              <span className="problem-ok">
                <CircleCheck size={14} aria-hidden="true" /> sem problemas
              </span>
            )}
          </fieldset>
        )}
        <Button variant="ghost" size="compact" onClick={() => downloadRef.current?.showModal()}>
          Baixar
        </Button>
        <button
          type="button"
          className="icon-btn build-toggle"
          aria-label={toggleLabel}
          title={toggleLabel}
          aria-expanded={open}
          onClick={() => setSettings({ panelOpen: !open })}
        >
          <ToggleIcon size={16} aria-hidden="true" />
        </button>
      </div>
      {isActive(build) && !stuck && <div className="build-progress" aria-hidden="true" />}
      <Dialog
        ref={downloadRef}
        title="Baixar"
        icon={<Download size={18} aria-hidden="true" />}
        kicker="Exportar projeto"
        footer={
          <div className="actions">
            <Button variant="ghost" onClick={() => downloadRef.current?.close()}>
              Fechar
            </Button>
          </div>
        }
      >
        <div className="dialog-list">
          <p className="dialog-list-heading">Código-fonte</p>
          <button type="button" onClick={withClose(() => projects.downloadSource(projectId))}>
            <Archive size={16} aria-hidden="true" />
            Fonte (.zip)
          </button>
          <button type="button" onClick={withClose(() => projects.downloadSource(projectId, true))}>
            <GitBranch size={16} aria-hidden="true" />
            Fonte com histórico git (.zip)
          </button>
          <p className="dialog-list-heading">Exportar como</p>
          {exportLabels.map(([format, label]) => (
            <button
              key={format}
              type="button"
              disabled={busy}
              onClick={withClose(() => exportAs.mutate(format))}
            >
              <FileText size={16} aria-hidden="true" />
              {label}
            </button>
          ))}
          <p className="dialog-list-heading">Ferramentas</p>
          <button type="button" disabled={busy} onClick={withClose(() => count.mutate())}>
            <Hash size={16} aria-hidden="true" />
            Contar palavras
          </button>
          {build?.status === 'succeeded' && (
            <>
              <p className="dialog-list-heading">Compilado</p>
              <button
                type="button"
                onClick={withClose(() => compile.downloadPdf(projectId, build.id))}
              >
                <FileDown size={16} aria-hidden="true" />
                PDF
              </button>
            </>
          )}
        </div>
      </Dialog>
      {open && (
        <div className="build-details">
          {build && (
            <Button
              variant="ghost"
              size="compact"
              onClick={() => compile.openLog(projectId, build.id)}
            >
              ver log completo
            </Button>
          )}
          {start.error && <p className="form-error">{start.error.message}</p>}
          {exportAs.error && <p className="form-error">{exportAs.error.message}</p>}
          {count.error && <p className="form-error">{count.error.message}</p>}
          {busy && <p className="status-note">Processando…</p>}
          {setEngine.error && <p className="form-error">{setEngine.error.message}</p>}
          {count.data && <p className="status-note">{count.data}</p>}
          {formatAll.error && <p className="form-error">{formatAll.error.message}</p>}
          {formatProgress && <p className="status-note">{formatProgress}</p>}
          {!build && (
            <p className="muted empty">
              Nenhuma compilação ainda. Clique em "Compilar" para ver logs, erros e avisos aqui.
            </p>
          )}
          {failureNote && (
            <p className="form-error">
              {failureNote}, mas nenhum erro foi extraído do log: os contadores ficam em zero por
              isso, não porque a compilação tenha dado certo. Use "ver log completo" acima para
              encontrar a causa.
            </p>
          )}
          {build?.status === 'succeeded' && nErrors === 0 && nWarnings === 0 && (
            <p className="muted empty">Compilado sem erros ou avisos.</p>
          )}
          {groups.length > 0 && (
            <div className="log-groups">
              {groups.map(({ file, items, errors, warnings }) => (
                <details key={file} className="log-group" open>
                  <summary title={file}>
                    <span className="log-file">{file || 'Geral'}</span>
                    <span className="log-group-counts">
                      {errors > 0 && <span data-kind="error">{errors}</span>}
                      {warnings > 0 && <span data-kind="warning">{warnings}</span>}
                    </span>
                  </summary>
                  <ul className="log-list">
                    {items.map(({ kind, entry }) => (
                      <LogItem
                        key={logKey(kind, entry)}
                        kind={kind}
                        entry={entry}
                        disabledUsed={kind === 'error' ? disabledUsed : undefined}
                      />
                    ))}
                  </ul>
                </details>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

type Kind = 'error' | 'warning';
type Item = { kind: Kind; entry: LogEntry };
type Group = { file: string; items: Item[]; errors: number; warnings: number };

const fileOf = (e: LogEntry) => (e.file ?? '').replace(/^\.\//, '');

/** Problems grouped per file, files with errors first, items by line. */
export function groupByFile(
  build: { errors: LogEntry[]; warnings: LogEntry[] },
  filter: Kind | 'all',
): Group[] {
  const items: Item[] = [
    ...(filter === 'warning'
      ? []
      : build.errors.map((entry) => ({ kind: 'error' as Kind, entry }))),
    ...(filter === 'error'
      ? []
      : build.warnings.map((entry) => ({ kind: 'warning' as Kind, entry }))),
  ];
  const byFile = new Map<string, Group>();
  for (const item of items) {
    const file = fileOf(item.entry);
    const g = byFile.get(file) ?? { file, items: [], errors: 0, warnings: 0 };
    g.items.push(item);
    if (item.kind === 'error') g.errors++;
    else g.warnings++;
    byFile.set(file, g);
  }
  for (const g of byFile.values())
    g.items.sort((a, b) => (a.entry.line ?? 0) - (b.entry.line ?? 0));
  return [...byFile.values()].sort((a, b) => b.errors - a.errors || a.file.localeCompare(b.file));
}

function LogItem({
  kind,
  entry,
  disabledUsed,
}: {
  kind: 'error' | 'warning';
  entry: LogEntry;
  disabledUsed?: string | undefined;
}) {
  const goToLine = useWorkspaceStore((s) => s.goToLine);
  const setActivePath = useWorkspaceStore((s) => s.setActivePath);
  const file = entry.file?.replace(/^\.\//, '');
  const go = () => {
    if (!file) return;
    if (entry.line) goToLine(file, entry.line);
    else setActivePath(file);
  };
  const Icon = kind === 'error' ? CircleX : TriangleAlert;
  const body = (
    <>
      <Icon size={14} aria-hidden="true" />
      <span className="log-line">{entry.line ? `l. ${entry.line}` : ''}</span>
      <span className="log-msg">
        {entry.message}
        {disabledUsed && /Undefined control sequence/.test(entry.message)
          ? ` · pacote ${disabledUsed} está desligado`
          : ''}
      </span>
    </>
  );
  return (
    <li className={`log-item log-${kind}`}>
      {file ? (
        <button type="button" className="log-row" title={`Abrir ${file}`} onClick={go}>
          {body}
        </button>
      ) : (
        <span className="log-row">{body}</span>
      )}
    </li>
  );
}

const logKey = (kind: string, e: LogEntry) => `${kind}|${e.file}|${e.line}|${e.message}`;
