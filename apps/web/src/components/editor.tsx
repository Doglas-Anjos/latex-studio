import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { basicSetup } from 'codemirror';
import { latex } from 'codemirror-lang-latex';
import { useEffect, useRef, useState } from 'react';
import { yCollab } from 'y-codemirror.next';
import * as Y from 'yjs';
import { useService } from '../di/service-provider';
import { FileServiceToken } from '../services/file.service';
import type { Role } from '../services/project.service';
import { useWorkspaceStore } from '../workspace-store';

const COLLAB_EXT = /\.(tex|bib|sty|cls|txt|md|json)$/i;
const IMAGE_EXT = /\.(png|jpe?g|gif|svg|webp)$/i;

const theme = EditorView.theme({
  '&': { height: '100%', color: 'var(--ink)', backgroundColor: 'var(--surface)' },
  '.cm-scroller': { fontFamily: 'ui-monospace, "Cascadia Code", Consolas, monospace' },
  '.cm-gutters': { backgroundColor: 'var(--paper)', color: 'var(--muted)', border: 'none' },
  '.cm-activeLine, .cm-activeLineGutter': {
    backgroundColor: 'color-mix(in srgb, var(--line) 40%, transparent)',
  },
  '.cm-cursor': { borderLeftColor: 'var(--ink)' },
});

type Status = 'connecting' | 'connected' | 'disconnected';
const statusLabel: Record<Status, string> = {
  connecting: 'Conectando…',
  connected: 'Conectado',
  disconnected: 'Reconectando…',
};

export function Editor({ projectId, path, role }: { projectId: string; path: string; role: Role }) {
  const files = useService(FileServiceToken);
  if (COLLAB_EXT.test(path)) return <CollabEditor projectId={projectId} path={path} role={role} />;
  const url = files.url(projectId, path);
  return (
    <div className="preview">
      {IMAGE_EXT.test(path) ? (
        <img src={url} alt={path} />
      ) : (
        <a href={url} download>
          Baixar {path}
        </a>
      )}
    </div>
  );
}

function revealLine(view: EditorView) {
  const { pendingLine, clearPendingLine } = useWorkspaceStore.getState();
  if (pendingLine === null) return;
  const line = view.state.doc.line(Math.min(Math.max(pendingLine, 1), view.state.doc.lines));
  view.dispatch({
    selection: { anchor: line.from },
    effects: EditorView.scrollIntoView(line.from, { y: 'center' }),
  });
  view.focus();
  clearPendingLine();
}

function CollabEditor({ projectId, path, role }: { projectId: string; path: string; role: Role }) {
  const host = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<Status>('connecting');
  const readOnly = role === 'viewer' || role === 'reviewer';

  // External sync: Yjs doc + websocket provider + CodeMirror view live and die with the file.
  useEffect(() => {
    const parent = host.current;
    if (!parent) return;
    const doc = new Y.Doc();
    const provider = new HocuspocusProvider({
      url: `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/collab`,
      name: `${projectId}/${path}`,
      document: doc,
      onStatus: ({ status: s }) => setStatus(s as Status),
    });
    const ytext = doc.getText('content');
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: ytext.toString(),
        extensions: [
          basicSetup,
          theme,
          EditorView.lineWrapping,
          EditorState.readOnly.of(readOnly),
          path.endsWith('.tex') ? latex() : [],
          yCollab(ytext, provider.awareness),
        ],
      }),
    });
    // A "go to line" request may arrive before or after the first sync.
    provider.on('synced', () => revealLine(view));
    const unsubscribe = useWorkspaceStore.subscribe((s, prev) => {
      if (s.pendingLine !== null && s.pendingLine !== prev.pendingLine) revealLine(view);
    });
    revealLine(view);
    return () => {
      unsubscribe();
      view.destroy();
      provider.destroy();
      doc.destroy();
    };
  }, [projectId, path, readOnly]);

  return (
    <div className="editor">
      <div ref={host} className="editor-host" />
      <div className="statusbar" data-status={status} role="status">
        <span className="dot" aria-hidden="true" /> {statusLabel[status]}
        {readOnly && ' · somente leitura'}
      </div>
    </div>
  );
}
