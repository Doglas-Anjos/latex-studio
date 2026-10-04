import { useMutation } from '@tanstack/react-query';
import { AlignLeft, UserPen } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useService } from '../../di/service-provider';
import type { Role } from '../../services/project.service';
import { ToolsServiceToken } from '../../services/tools.service';
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
};

export function StatusBar({ projectId, role }: { projectId: string; role: Role }) {
  const connection = useWorkspaceStore((s) => s.connection);
  const peers = useWorkspaceStore((s) => s.peers);
  const wordCount = useWorkspaceStore((s) => s.wordCount);
  const commands = useWorkspaceStore((s) => s.editorCommands);
  const activePath = useWorkspaceStore((s) => s.activePath);
  const blameOn = useWorkspaceStore((s) => s.blameOn);
  const toggleBlame = useWorkspaceStore((s) => s.toggleBlame);
  const tools = useService(ToolsServiceToken);
  const { data: builds } = useBuilds(projectId);
  const build = builds?.[0];
  const readOnly = role === 'viewer' || role === 'reviewer';
  const [note, setNote] = useState('');
  useEffect(() => {
    if (!note) return;
    const id = setTimeout(() => setNote(''), 4000);
    return () => clearTimeout(id);
  }, [note]);
  // latexindent in the worker; without it (local dev without TeX Live) CodeMirror's indenter.
  const format = useMutation({
    mutationFn: async () => {
      if (!commands || !activePath) return;
      const before = commands.getText();
      try {
        const { jobId } = await tools.format(projectId, activePath, before);
        const r = await waitForJob<{ text: string }>(tools, projectId, jobId);
        // Someone typed meanwhile: applying would revert their edit.
        if (r && commands.getText() !== before) throw new Error('changed');
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
        <span className="dot" aria-hidden="true" />
        {connLabel[connection]}
        {readOnly && ' · somente leitura'}
        {peers.map((p) => (
          <span key={p.name} className="peer">
            <span className="dot" style={{ background: p.color }} aria-hidden="true" />
            {p.name}
          </span>
        ))}
      </div>
      <div className="status-group">
        {build && (
          <span data-status={build.status}>
            {(build.status === 'running' || build.status === 'queued') && (
              <span className="spinner" aria-hidden="true" />
            )}
            {buildLabel[build.status]}
          </span>
        )}
        {wordCount !== null && <span>~{wordCount} palavras</span>}
        {note && <span className="status-note-inline">{note}</span>}
        <button
          type="button"
          className="status-btn"
          disabled={!canFormat || format.isPending}
          title={canFormat ? 'Formatar com latexindent' : 'Só arquivos LaTeX'}
          onClick={() => format.mutate()}
        >
          <AlignLeft size={12} aria-hidden="true" />{' '}
          {format.isPending ? 'Formatando…' : 'Auto-indent'}
        </button>
        <button
          type="button"
          className="status-btn"
          aria-pressed={blameOn}
          title="Quem alterou cada linha"
          onClick={toggleBlame}
        >
          <UserPen size={12} aria-hidden="true" /> Blame
        </button>
      </div>
    </footer>
  );
}
