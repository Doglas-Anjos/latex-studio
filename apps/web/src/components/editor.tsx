import { indentSelection } from '@codemirror/commands';
import { syntaxHighlighting } from '@codemirror/language';
import { diff } from '@codemirror/merge';
import {
  Compartment,
  EditorState,
  type Extension,
  StateEffect,
  StateField,
} from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView } from '@codemirror/view';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { useQuery } from '@tanstack/react-query';
import { basicSetup } from 'codemirror';
import { latex } from 'codemirror-lang-latex';
import { useEffect, useRef, useState } from 'react';
import { yCollab } from 'y-codemirror.next';
import * as Y from 'yjs';
import { useMe } from '../auth-hooks';
import { useService } from '../di/service-provider';
import { type Comment, CommentServiceToken } from '../services/comment.service';
import { FileServiceToken } from '../services/file.service';
import { HistoryServiceToken } from '../services/history.service';
import { IdentityToken } from '../services/identity';
import type { Role } from '../services/project.service';
import { useSettingsStore } from '../settings-store';
import { type Connection, useWorkspaceStore } from '../workspace-store';
import { blameGutter, setBlame } from './editor-blame';
import { changeGutter, setChangeBase } from './editor-changes';
import { editorTheme, latexHighlight } from './editor-theme';
import { peerColor } from './presence';
import { approxWords } from './word-count';

const COLLAB_EXT = /\.(tex|bib|sty|cls|txt|md|json)$/i;
const IMAGE_EXT = /\.(png|jpe?g|gif|svg|webp)$/i;

const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromBase64 = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const encodePos = (ytext: Y.Text, index: number) =>
  toBase64(Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(ytext, index)));

/** Absolute index of a stored relative position, or null if it no longer resolves. */
function resolvePos(ytext: Y.Text, b64: string): number | null {
  try {
    const abs = ytext.doc
      ? Y.createAbsolutePositionFromRelativePosition(
          Y.decodeRelativePosition(fromBase64(b64)),
          ytext.doc,
        )
      : null;
    return abs && abs.type === ytext ? abs.index : null;
  } catch {
    return null;
  }
}

const refreshHighlights = StateEffect.define<null>();

/** Highlights open comments; positions are re-resolved on every doc change so they follow edits. */
function commentHighlights(ytext: Y.Text, comments: { current: Comment[] }): Extension {
  const field = StateField.define<DecorationSet>({
    create: () => Decoration.none,
    update(deco, tr) {
      if (!tr.docChanged && !tr.effects.some((e) => e.is(refreshHighlights))) return deco;
      const length = tr.state.doc.length;
      return Decoration.set(
        comments.current.flatMap((c) => {
          const from = resolvePos(ytext, c.anchor.start);
          const to = resolvePos(ytext, c.anchor.end);
          if (from === null || to === null || from >= to || to > length) return [];
          return [
            Decoration.mark({
              class: 'cm-comment',
              attributes: { 'data-comment-id': c.id },
            }).range(from, to),
          ];
        }),
        true,
      );
    },
    provide: (f) => EditorView.decorations.from(f),
  });
  return [
    field,
    EditorView.domEventHandlers({
      click(event) {
        const id = (event.target as HTMLElement)
          .closest?.('[data-comment-id]')
          ?.getAttribute('data-comment-id');
        if (id) useWorkspaceStore.getState().setActiveComment(id);
        return false;
      },
    }),
  ];
}

export function Editor({ projectId, path, role }: { projectId: string; path: string; role: Role }) {
  const files = useService(FileServiceToken);
  if (COLLAB_EXT.test(path)) return <CollabEditor projectId={projectId} path={path} role={role} />;
  return (
    <div className="preview">
      {IMAGE_EXT.test(path) ? (
        <AuthImage projectId={projectId} path={path} />
      ) : (
        <button type="button" onClick={() => files.download(projectId, path)}>
          Baixar {path}
        </button>
      )}
    </div>
  );
}

/** Images need the Authorization header, so they load through fetch into a blob URL. */
function AuthImage({ projectId, path }: { projectId: string; path: string }) {
  const files = useService(FileServiceToken);
  const [src, setSrc] = useState<string>();
  useEffect(() => {
    let url: string | undefined;
    let cancelled = false;
    files
      .blob(projectId, path)
      .then((b) => {
        url = URL.createObjectURL(b);
        if (cancelled) URL.revokeObjectURL(url);
        else setSrc(url);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [files, projectId, path]);
  return src ? <img src={src} alt={path} /> : null;
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
  const readOnly = role === 'viewer' || role === 'reviewer';
  const comments = useService(CommentServiceToken);
  const identity = useService(IdentityToken);
  const history = useService(HistoryServiceToken);
  const me = useMe().data;
  const viewRef = useRef<EditorView | null>(null);
  const providerRef = useRef<HocuspocusProvider | null>(null);
  // Baseline text for the change gutter: the file at the last saved version ('' if new).
  const changeBase = useRef<string | null>(null);
  const { data: status } = useQuery({
    queryKey: ['history', projectId, 'status'],
    queryFn: () => history.status(projectId),
    refetchInterval: 5000,
  });
  const baseSha = status ? (status.baseline?.sha ?? '') : null;
  const { data: baseText } = useQuery({
    queryKey: ['history', projectId, 'base', baseSha, path],
    queryFn: () => (baseSha ? history.file(projectId, baseSha, path).catch(() => '') : ''),
    enabled: baseSha !== null,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const blameOn = useWorkspaceStore((s) => s.blameOn);
  const { data: blame } = useQuery({
    queryKey: ['history', projectId, 'blame', path],
    queryFn: () => history.blame(projectId, path),
    enabled: blameOn,
    staleTime: 30_000,
  });
  const { data } = useQuery({
    queryKey: ['comments', projectId, path, false],
    queryFn: () => comments.list(projectId, path, false),
  });
  const commentsRef = useRef<Comment[]>([]);
  commentsRef.current = data ?? [];

  // External sync: Yjs doc + websocket provider + CodeMirror view live and die with the file.
  useEffect(() => {
    const parent = host.current;
    if (!parent) return;
    const doc = new Y.Doc();
    const provider = new HocuspocusProvider({
      url: `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/collab`,
      name: `${projectId}/${path}`,
      document: doc,
      token: async () => (await identity.token()) ?? '',
      onStatus: ({ status }) => useWorkspaceStore.getState().setConnection(status as Connection),
    });
    const ytext = doc.getText('content');
    const wrap = new Compartment();
    const wrapping = (on: boolean) => (on ? EditorView.lineWrapping : []);
    let wordTimer: ReturnType<typeof setTimeout> | undefined;
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: ytext.toString(),
        extensions: [
          basicSetup,
          syntaxHighlighting(latexHighlight),
          editorTheme,
          wrap.of(wrapping(useSettingsStore.getState().lineWrapping)),
          EditorState.readOnly.of(readOnly),
          path.endsWith('.tex') ? latex() : [],
          yCollab(ytext, provider.awareness),
          commentHighlights(ytext, commentsRef),
          changeGutter(changeBase),
          blameGutter(),
          EditorView.updateListener.of((u) => {
            if (!u.docChanged) return;
            clearTimeout(wordTimer);
            wordTimer = setTimeout(
              () => useWorkspaceStore.getState().setWordCount(approxWords(u.state.doc.toString())),
              500,
            );
          }),
        ],
      }),
    });
    viewRef.current = view;
    const store = useWorkspaceStore.getState();
    store.setConnection('connecting');
    store.setWordCount(approxWords(view.state.doc.toString()));
    store.setEditorCommands({
      indentAll() {
        const head = view.state.selection.main.head;
        view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } });
        indentSelection(view);
        const at = Math.min(head, view.state.doc.length);
        view.dispatch({ selection: { anchor: at } });
      },
      applyText(text) {
        const current = view.state.doc.toString();
        if (text === current) return;
        const changes = diff(current, text).map((c) => ({
          from: c.fromA,
          to: c.toA,
          insert: text.slice(c.fromB, c.toB),
        }));
        view.dispatch({ changes, userEvent: 'format' });
      },
      getText: () => view.state.doc.toString(),
    });
    store.setSelectionProvider(() => {
      const { from, to } = view.state.selection.main;
      if (from === to) return null;
      return {
        anchor: { start: encodePos(ytext, from), end: encodePos(ytext, to) },
        quote: view.state.sliceDoc(from, Math.min(to, from + 500)),
        line: view.state.doc.lineAt(from).number,
      };
    });
    const revealComment = (id: string) => {
      const c = commentsRef.current.find((x) => x.id === id);
      const pos = c ? resolvePos(ytext, c.anchor.start) : null;
      if (pos !== null) {
        view.dispatch({
          selection: { anchor: Math.min(pos, view.state.doc.length) },
          effects: EditorView.scrollIntoView(pos, { y: 'center' }),
        });
        view.focus();
      } else if (c?.line) {
        useWorkspaceStore.getState().goToLine(path, c.line);
      }
    };
    // A "go to line" request may arrive before or after the first sync.
    provider.on('synced', () => revealLine(view));
    const unsubWrap = useSettingsStore.subscribe((s, prev) => {
      if (s.lineWrapping !== prev.lineWrapping)
        view.dispatch({ effects: wrap.reconfigure(wrapping(s.lineWrapping)) });
    });
    const awareness = provider.awareness;
    if (!awareness) throw new Error('awareness unavailable');
    providerRef.current = provider;
    const onAwareness = () => {
      const byName = new Map<string, { name: string; color: string }>();
      for (const [id, state] of awareness.getStates()) {
        const u = state.user as { name: string; color: string } | undefined;
        if (id !== awareness.clientID && u) byName.set(u.name, { name: u.name, color: u.color });
      }
      useWorkspaceStore.getState().setPeers([...byName.values()]);
    };
    awareness.on('change', onAwareness);
    const unsubscribe = useWorkspaceStore.subscribe((s, prev) => {
      if (s.pendingLine !== null && s.pendingLine !== prev.pendingLine) revealLine(view);
      if (s.commentJump && s.commentJump !== prev.commentJump) revealComment(s.commentJump.id);
    });
    revealLine(view);
    return () => {
      unsubscribe();
      unsubWrap();
      awareness.off('change', onAwareness);
      useWorkspaceStore.getState().setPeers([]);
      clearTimeout(wordTimer);
      useWorkspaceStore.getState().setEditorCommands(null);
      useWorkspaceStore.getState().setWordCount(null);
      useWorkspaceStore.getState().setSelectionProvider(null);
      viewRef.current = null;
      providerRef.current = null;
      view.destroy();
      provider.destroy();
      doc.destroy();
    };
  }, [projectId, path, readOnly, identity.token]);

  useEffect(() => {
    const text = baseText ?? null;
    changeBase.current = text;
    viewRef.current?.dispatch({ effects: setChangeBase.of(text) });
  }, [baseText]);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: setBlame.of(blameOn ? (blame ?? null) : null) });
  }, [blame, blameOn]);

  // Own cursor label; separate so a late /me answer does not rebuild the editor.
  useEffect(() => {
    const awareness = providerRef.current?.awareness;
    if (!awareness || !me) return;
    const color = peerColor(me.id);
    awareness.setLocalStateField('user', {
      name: me.name || me.email,
      color,
      colorLight: `${color}33`,
    });
  }, [me]);

  // Rebuild highlights when comments change.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `data` is the trigger; highlights read it via commentsRef
  useEffect(() => {
    viewRef.current?.dispatch({ effects: refreshHighlights.of(null) });
  }, [data]);

  return (
    <div className="editor">
      <div ref={host} className="editor-host" />
    </div>
  );
}
