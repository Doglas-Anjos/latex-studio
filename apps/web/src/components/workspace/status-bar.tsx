import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlignLeft, CircleX, Save, TriangleAlert, UserPen } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useService } from '../../di/service-provider';
import { isActive } from '../../services/compile.service';
import { HistoryServiceToken } from '../../services/history.service';
import type { Role } from '../../services/project.service';
import { ToolsServiceToken } from '../../services/tools.service';
import { useSettingsStore } from '../../settings-store';
import { useWorkspaceStore } from '../../workspace-store';
import { useBuilds } from '../use-builds';
import { waitForJob } from '../use-tools-job';

const FORMATTABLE = /\.(tex|sty|cls|bib)$/i;

const connLabel = {
  connecting: 'Conectando…',
  connected: 'Conectado',
  disconnected: 'Reconectando…',
};
const buildLabel = {
  queued: 'Na fila…',
  running: 'Compilando…',
  succeeded: 'Compilado',
  failed: 'Falhou',
  timeout: 'Falhou',
  cancelled: 'Cancelada',
};

export function StatusBar({
  projectId,
  role,
  path,
}: {
  projectId: string;
  role: Role;
  /** The file Ctrl+S commits; null when no file is open. */
  path: string | null;
}) {
  const connection = useWorkspaceStore((s) => s.connection);
  const peers = useWorkspaceStore((s) => s.peers);
  const wordCount = useWorkspaceStore((s) => s.wordCount);
  const commands = useWorkspaceStore((s) => s.editorCommands);
  const activePath = useWorkspaceStore((s) => s.activePath);
  const blameOn = useWorkspaceStore((s) => s.blameOn);
  const toggleBlame = useWorkspaceStore((s) => s.toggleBlame);
  const tools = useService(ToolsServiceToken);
  const history = useService(HistoryServiceToken);
  const queryClient = useQueryClient();
  const { data: builds } = useBuilds(projectId);
  const build = builds?.[0];
  const openPanel = useSettingsStore((s) => s.set);
  const readOnly = role === 'viewer' || role === 'reviewer';
  const [note, setNote] = useState('');
  useEffect(() => {
    if (!note) return;
    const id = setTimeout(() => setNote(''), 4000);
    return () => clearTimeout(id);
  }, [note]);
  // Ctrl+S commits only the open file; the server flushes its live Yjs text to the working
  // tree first, since onStoreDocument otherwise debounces 2-10s.
  const save = useMutation({
    mutationFn: (p: string) => history.commitFile(projectId, p),
    onSuccess: () => {
      setNote('Arquivo salvo');
      return queryClient.invalidateQueries({ queryKey: ['history', projectId] });
    },
    onError: (e: Error) => {
      setNote(e.message === 'Nothing to commit' ? 'Nada para salvar' : 'Falha ao salvar o arquivo');
    },
  });
  // The mutation object changes every render; a ref keeps the listener bound once per path.
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 's') return;
      e.preventDefault();
      if (!path) return;
      if (readOnly) {
        setNote('Somente leitura: nada para salvar');
        return;
      }
      if (saveRef.current.isPending) return;
      saveRef.current.mutate(path);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [path, readOnly]);
  // latexindent in the worker; without it (local dev without TeX Live) CodeMirror's indenter.
  const format = useMutation({
    mutationFn: async () => {
      if (!commands || !activePath) return;
      const before = commands.getText();
      try {
        const { jobId } = await tools.format(projectId, activePath, before);
        const r = await waitForJob<{ text: string }>(tools, projectId, jobId);
        // Someone typed meanwhile, or another file is open now: applying would clobber it.
        const live = useWorkspaceStore.getState().editorCommands;
        if (r && (live !== commands || commands.getText() !== before)) throw new Error('changed');
        if (r) commands.applyText(r.text);
      } catch (e) {
        if ((e as Error).message === 'changed') {
          setNote('O documento mudou durante a formatação; tente de novo');
          return;
        }
        commands.indentAll();
        setNote('latexindent indisponível; indentação local aplicada');
      }
    },
  });
  const canFormat = !!commands && !readOnly && !!activePath && FORMATTABLE.test(activePath);
  return (
    <footer className="status-bar">
      <div className="status-group" data-status={connection} role="status">
        <span className="status-item">
          <span className="dot" aria-hidden="true" />
          {connLabel[connection]}
        </span>
        {readOnly && <span className="status-pill">Somente leitura</span>}
        {peers.length > 0 && (
          <span className="status-item peer-list">
            {peers.map((p) => (
              <span key={p.id} className="peer">
                <span className="dot" style={{ background: p.color }} aria-hidden="true" />
                {p.name}
              </span>
            ))}
          </span>
        )}
      </div>
      <div className="status-group">
        {build && (
          <span className="status-item status-build" data-status={build.status}>
            {(build.status === 'running' || build.status === 'queued') && (
              <span className="spinner" aria-hidden="true" />
            )}
            {buildLabel[build.status]}
          </span>
        )}
        {build && !isActive(build) && (
          <button
            type="button"
            className="status-btn status-problems"
            title="Erros e avisos da compilação"
            onClick={() => openPanel({ panelOpen: true })}
          >
            <span data-kind="error">
              <CircleX size={12} aria-hidden="true" /> {build.errors.length}
            </span>
            <span data-kind="warning">
              <TriangleAlert size={12} aria-hidden="true" /> {build.warnings.length}
            </span>
          </button>
        )}
        {wordCount !== null && (
          <span className="status-item status-wordcount">~{wordCount} palavras</span>
        )}
        {note && <span className="status-note-inline">{note}</span>}
        {save.isPending && (
          <span className="status-item" role="status">
            <span className="spinner" aria-hidden="true" />
            Salvando…
          </span>
        )}
        <button
          type="button"
          className="status-btn"
          disabled={readOnly || !path || save.isPending}
          title={readOnly ? 'Somente leitura' : 'Salvar arquivo (Ctrl+S)'}
          aria-label="Salvar arquivo"
          onClick={() => path && save.mutate(path)}
        >
          <Save size={12} aria-hidden="true" /> <span className="status-btn-label">Salvar</span>
        </button>
        <button
          type="button"
          className="status-btn"
          disabled={!canFormat || format.isPending}
          title={canFormat ? 'Formatar com latexindent' : 'Só arquivos LaTeX'}
          aria-label={canFormat ? 'Formatar com latexindent' : 'Só arquivos LaTeX'}
          onClick={() => format.mutate()}
        >
          <AlignLeft size={12} aria-hidden="true" />{' '}
          <span className="status-btn-label">
            {format.isPending ? 'Formatando…' : 'Auto-indent'}
          </span>
        </button>
        <button
          type="button"
          className="status-btn"
          aria-pressed={blameOn}
          title="Quem alterou cada linha"
          aria-label="Quem alterou cada linha"
          onClick={toggleBlame}
        >
          <UserPen size={12} aria-hidden="true" /> <span className="status-btn-label">Blame</span>
        </button>
      </div>
    </footer>
  );
}
