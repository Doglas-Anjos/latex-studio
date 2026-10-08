import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  Ban,
  Check,
  ChevronDown,
  ChevronUp,
  CircleCheck,
  CircleX,
  Download,
  FileDown,
  FileText,
  GitBranch,
  Hash,
  Info,
  Loader2,
  Square,
  TriangleAlert,
} from 'lucide-react';
import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
  cancelled: 'Cancelada',
};

const statusIcons: Record<Build['status'], typeof CircleCheck> = {
  queued: Loader2,
  running: Loader2,
  succeeded: CircleCheck,
  failed: CircleX,
  timeout: CircleX,
  cancelled: Ban,
};

const exportLabels: [ExportFormat, string][] = [
  ['docx', 'DOCX'],
  ['md', 'Markdown'],
  ['html', 'HTML'],
];

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
  // All of them: the error does not say which package defined the missing command.
  const disabledUsed = manifest
    ?.filter((e) => !e.enabled && usage?.some((u) => u.name === e.name))
    .map((e) => e.name)
    .join(', ');
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
  const nInfo = build?.info?.length ?? 0;
  const autoCompile = useSettingsStore((s) => s.autoCompile);
  const draftMode = useSettingsStore((s) => s.draftMode);
  const stopOnFirstError = useSettingsStore((s) => s.stopOnFirstError);
  const failureNote = build ? unexplainedFailure(build) : null;
  const groups = build ? groupByFile(build, filter) : [];
  const start = useMutation({
    mutationFn: () =>
      compile.compile(projectId, { draft: draftMode, haltOnError: stopOnFirstError }),
    onSuccess: (b) => queryClient.setQueryData(['builds', projectId], [b, ...(builds ?? [])]),
    onError: showPanel,
  });
  const stop = useMutation({
    mutationFn: (buildId: string) => compile.cancel(projectId, buildId),
    onSuccess: (b) =>
      queryClient.setQueryData<Build[]>(['builds', projectId], (prev) =>
        (prev ?? []).map((x) => (x.id === b.id ? b : x)),
      ),
    onError: showPanel,
  });
  // Auto compile: the editor bumps docVersion on each local edit (remote edits and loads do not);
  // 3 s after the last one, compile unless a build is already requested or in flight.
  const docVersion = useWorkspaceStore((s) => s.docVersion);
  const seenVersion = useRef(docVersion);
  const autoFire = useRef(() => {});
  autoFire.current = () => {
    const latest = queryClient.getQueryData<Build[]>(['builds', projectId])?.[0];
    if (!start.isPending && !isActive(latest)) start.mutate();
  };
  useEffect(() => {
    if (!autoCompile || !canCompile || docVersion === seenVersion.current) return;
    seenVersion.current = docVersion;
    const id = window.setTimeout(() => autoFire.current(), 3000);
    return () => window.clearTimeout(id);
  }, [docVersion, autoCompile, canCompile]);
  const [menuOpen, setMenuOpen] = useState(false);
  const caretRef = useRef<HTMLButtonElement>(null);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
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
  const running = isActive(build) && !stuck;
  const compileDisabled = !canCompile || start.isPending || engineUnconfirmed;
  const mainDisabled = running ? stop.isPending : compileDisabled;
  const compileTitle = !canCompile
    ? 'Você não tem permissão para compilar este projeto'
    : engineUnconfirmed
      ? 'Aguarde: salvando o motor LaTeX escolhido'
      : stuck && build
        ? `Sem resposta há ${elapsedSeconds(build)}s; clique para tentar novamente`
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
        const live =
          editorCommands && path === (activePath ?? project?.mainFile) ? editorCommands : null;
        const read = async () =>
          live ? live.getText() : (await files.blob(projectId, path)).text();
        const before = await read();
        const { jobId } = await tools.format(projectId, path, before);
        const r = await waitFor<{ text: string }>(jobId);
        // Edited meanwhile (here or by a collaborator), or the editor now shows another file:
        // skip rather than revert their change or write into the wrong document.
        const editorChanged = live && useWorkspaceStore.getState().editorCommands !== live;
        if (!r || editorChanged || (await read()) !== before) {
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
        <div className="split-btn">
          {running && build ? (
            <Button
              variant="danger"
              size="compact"
              disabled={mainDisabled}
              title="Parar a compilação em andamento"
              onClick={() => stop.mutate(build.id)}
            >
              <Square size={12} aria-hidden="true" /> Parar
            </Button>
          ) : (
            <Button
              variant="primary"
              size="compact"
              disabled={mainDisabled}
              title={compileTitle}
              onClick={() => start.mutate()}
            >
              {stuck ? 'Tentar novamente' : 'Compilar'}
            </Button>
          )}
          <Button
            ref={caretRef}
            variant={running ? 'danger' : 'primary'}
            size="compact"
            disabled={mainDisabled}
            aria-label="Opções de compilação"
            title="Opções de compilação"
            aria-haspopup="true"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((o) => !o)}
          >
            <ChevronDown size={14} aria-hidden="true" />
          </Button>
        </div>
        {menuOpen && (
          <CompileMenu anchor={caretRef} onClose={closeMenu}>
            <MenuGroup label="Compilação automática">
              <MenuChoice checked={autoCompile} onPick={() => setSettings({ autoCompile: true })}>
                Ligada
              </MenuChoice>
              <MenuChoice checked={!autoCompile} onPick={() => setSettings({ autoCompile: false })}>
                Desligada
              </MenuChoice>
            </MenuGroup>
            <MenuGroup label="Modo">
              <MenuChoice checked={!draftMode} onPick={() => setSettings({ draftMode: false })}>
                Normal
              </MenuChoice>
              <MenuChoice checked={draftMode} onPick={() => setSettings({ draftMode: true })}>
                Rápido (rascunho: imagens como molduras)
              </MenuChoice>
            </MenuGroup>
            <MenuGroup label="Erros">
              <MenuChoice
                checked={stopOnFirstError}
                onPick={() => setSettings({ stopOnFirstError: true })}
              >
                Parar no primeiro erro
              </MenuChoice>
              <MenuChoice
                checked={!stopOnFirstError}
                onPick={() => setSettings({ stopOnFirstError: false })}
              >
                Tentar compilar mesmo com erros
              </MenuChoice>
            </MenuGroup>
            <div className="compile-menu-actions">
              <button
                type="button"
                disabled={!running || !build || stop.isPending}
                onClick={() => {
                  if (build) stop.mutate(build.id);
                  setMenuOpen(false);
                }}
              >
                Parar compilação
              </button>
              <button
                type="button"
                disabled={compileDisabled || running}
                onClick={() => {
                  start.mutate();
                  setMenuOpen(false);
                }}
              >
                Recompilar
              </button>
            </div>
          </CompileMenu>
        )}
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
            <button
              type="button"
              className="problem-count"
              data-kind="info"
              aria-pressed={filter === 'info'}
              disabled={nInfo === 0}
              onClick={() => pick('info')}
            >
              <Info size={14} aria-hidden="true" />
              {nInfo} info
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
          {/* Export and word count run worker jobs: editors only, like compile. */}
          {canCompile && (
            <>
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
            </>
          )}
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

type Kind = 'error' | 'warning' | 'info';
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
  kind: Kind;
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
  const Icon = kind === 'error' ? CircleX : kind === 'warning' ? TriangleAlert : Info;
  const body = (
    <>
      <Icon size={14} aria-hidden="true" />
      <span className="log-line">{entry.line ? `l. ${entry.line}` : ''}</span>
      <span className="log-msg">
        {entry.message}
        {disabledUsed && /Undefined control sequence/.test(entry.message)
          ? ` · desligado no painel e usado no código: ${disabledUsed}`
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

function MenuGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="compile-menu-group">
      <span className="compile-menu-label">{label}</span>
      {children}
    </div>
  );
}

function MenuChoice({
  checked,
  onPick,
  children,
}: {
  checked: boolean;
  onPick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button type="button" aria-pressed={checked} onClick={onPick}>
      <span className="compile-menu-check" aria-hidden="true">
        {checked && <Check size={14} />}
      </span>
      {children}
    </button>
  );
}

/**
 * Rendered in a portal with fixed coordinates: the build bar lives inside a clipped bottom panel,
 * so an in-flow dropdown gets cut off. Flips above the caret when there is no room below.
 * Focus moves to the first item on open and back to the caret on any close (it sits in <body>,
 * far from the caret in tab order).
 */
function CompileMenu({
  anchor,
  onClose,
  children,
}: {
  anchor: React.RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<React.CSSProperties>({ visibility: 'hidden' });
  useEffect(() => {
    const r = anchor.current?.getBoundingClientRect();
    const h = ref.current?.offsetHeight ?? 320;
    if (!r) return;
    const below = r.bottom + 4 + h <= window.innerHeight;
    setPos({
      position: 'fixed',
      left: Math.max(8, Math.min(r.left, window.innerWidth - 272)),
      // Exactly one of top/bottom: both at once squeeze the menu to nothing.
      ...(below
        ? { top: r.bottom + 4, bottom: 'auto' }
        : { top: 'auto', bottom: window.innerHeight - r.top + 4 }),
    });
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !anchor.current?.contains(t)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [anchor, onClose]);
  useEffect(() => {
    ref.current?.querySelector('button')?.focus();
    const caret = anchor.current;
    return () => caret?.focus();
  }, [anchor]);
  return createPortal(
    <div ref={ref} className="compile-menu-body" style={pos}>
      {children}
    </div>,
    document.body,
  );
}
