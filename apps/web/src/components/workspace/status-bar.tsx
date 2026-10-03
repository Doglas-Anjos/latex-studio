import { AlignLeft } from 'lucide-react';
import type { Role } from '../../services/project.service';
import { useWorkspaceStore } from '../../workspace-store';
import { useBuilds } from '../use-builds';

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
  const { data: builds } = useBuilds(projectId);
  const build = builds?.[0];
  const readOnly = role === 'viewer' || role === 'reviewer';
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
        <button
          type="button"
          className="status-btn"
          disabled={!commands || readOnly}
          onClick={() => commands?.indentAll()}
        >
          <AlignLeft size={12} aria-hidden="true" /> Auto-indent
        </button>
      </div>
    </footer>
  );
}
