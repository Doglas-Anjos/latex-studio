import { indentSelection } from '@codemirror/commands';
import { syntaxHighlighting } from '@codemirror/language';
import { diff } from '@codemirror/merge';
import { Compartment, EditorState, type Extension, type Transaction } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { basicSetup } from 'codemirror';
import { Heading, MessageSquarePlus, Rows, Type, X } from 'lucide-react';
import { type CSSProperties, useEffect, useRef, useState } from 'react';
import { yCollab } from 'y-codemirror.next';
import * as Y from 'yjs';
import { useMe } from '../auth-hooks';
import type { CommentScope } from '../comment-scope';
import { lineRangeAt, SCOPE_LABELS, scopeEmptyReason, scopeRange } from '../comment-scope';
import { useService } from '../di/service-provider';
import { useHistoryStatus } from '../hooks/use-history-status';
import { type Comment, CommentServiceToken, type NewComment } from '../services/comment.service';
import { FileServiceToken } from '../services/file.service';
import { HistoryServiceToken } from '../services/history.service';
import { IdentityToken } from '../services/identity';
import type { Role } from '../services/project.service';
import { useSettingsStore } from '../settings-store';
import {
  type CommentDraft,
  type Connection,
  type Peer,
  useWorkspaceStore,
} from '../workspace-store';
import { Button } from './button';
import { commentGutter } from './comment-gutter';
import { CommentMenu } from './comment-menu';
import { blameGutter, blameVisible, setBlame } from './editor-blame';
import { changeGutter, DIFF_LIMITS, setChangeBase } from './editor-changes';
import {
  type ComposerRect,
  type ComposerTarget,
  commentComposer,
  commentHighlights,
  placePopup,
  refreshHighlights,
  type SelectionAffordance,
  selectionAffordance,
  setComposerTarget,
} from './editor-comments';
import { editorTheme, latexHighlight } from './editor-theme';
import { latexSupport } from './latex-language';
import { peerColor } from './presence';
import { useZoom } from './use-zoom';
import { approxWords } from './word-count';
import { encodeAnchorPos, resolveAnchorPos } from './yjs-anchor';
import { ZoomControls } from './zoom-controls';

const COLLAB_EXT = /\.(tex|bib|sty|cls|txt|md|json)$/i;
const IMAGE_EXT = /\.(png|jpe?g|gif|svg|webp)$/i;

const SCOPE_SHORTCUTS: { scope: CommentScope; key: string; hint: string }[] = [
  { scope: 'selection', key: 'Mod-Alt-1', hint: 'Ctrl/Cmd+Alt+1' },
  { scope: 'word', key: 'Mod-Alt-2', hint: 'Ctrl/Cmd+Alt+2' },
  { scope: 'line', key: 'Mod-Alt-3', hint: 'Ctrl/Cmd+Alt+3' },
  { scope: 'section', key: 'Mod-Alt-4', hint: 'Ctrl/Cmd+Alt+4' },
];

const SCOPE_ICON: Record<CommentScope, typeof Type> = {
  selection: MessageSquarePlus,
  word: Type,
  line: Rows,
  section: Heading,
};

/** Typing, deleting, undo/redo by this user: remote updates and formatting do not count. */
export const isLocalEdit = (tr: Transaction) =>
  ['input', 'delete', 'undo', 'redo'].some((e) => tr.isUserEvent(e));

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/** Remote awareness states as peers, one per client (two tabs of one user are two peers). */
/**
 * Other people editing this file. `selfUser` drops the same account in another tab or a
 * connection that has not timed out yet, which otherwise shows up as a second "you".
 */
export function peersFrom(
  states: Map<number, Record<string, unknown>>,
  self: number,
  selfUser?: string,
): Peer[] {
  const peers: Peer[] = [];
  for (const [id, state] of states) {
    const u = state.user as { id?: unknown; name?: unknown; color?: unknown } | undefined;
    if (id === self || typeof u?.name !== 'string') continue;
    if (selfUser && u.id === selfUser) continue;
    // Remote-controlled: only a plain hex colour reaches a style attribute.
    const color = typeof u.color === 'string' && HEX_COLOR.test(u.color) ? u.color : 'var(--muted)';
    peers.push({ id, name: u.name, color });
  }
  return peers;
}

const unsynced = new Set<object>();
const confirmLeave = (e: BeforeUnloadEvent) => e.preventDefault();
/** One beforeunload prompt, registered only while some editor holds edits the server lacks. */
export function markUnsynced(provider: object, dirty: boolean) {
  const before = unsynced.size;
  if (dirty) unsynced.add(provider);
  else unsynced.delete(provider);
  if (!before && unsynced.size) window.addEventListener('beforeunload', confirmLeave);
  if (before && !unsynced.size) window.removeEventListener('beforeunload', confirmLeave);
}

type Closable = Pick<HocuspocusProvider, 'hasUnsyncedChanges' | 'on' | 'destroy'>;
/** Destroys provider and doc once the last local edit reached the server, or after 5 s. */
export function closeWhenSynced(provider: Closable, doc: Pick<Y.Doc, 'destroy'>) {
  let done = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const finish = () => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    markUnsynced(provider, false);
    provider.destroy();
    doc.destroy();
  };
  if (!provider.hasUnsyncedChanges) return finish();
  provider.on('unsyncedChanges', ({ number }: { number: number }) => number === 0 && finish());
  timer = setTimeout(finish, 5000);
}

export function Editor({ projectId, path, role }: { projectId: string; path: string; role: Role }) {
  const files = useService(FileServiceToken);
  if (COLLAB_EXT.test(path)) return <CollabEditor projectId={projectId} path={path} role={role} />;
  if (IMAGE_EXT.test(path)) return <ImagePreview projectId={projectId} path={path} />;
  return (
    <div className="preview">
      <button type="button" onClick={() => files.download(projectId, path)}>
        Baixar {path}
      </button>
    </div>
  );
}

function ImagePreview({ projectId, path }: { projectId: string; path: string }) {
  const body = useRef<HTMLDivElement>(null);
  const { zoom, zoomIn, zoomOut, reset } = useZoom(body);
  return (
    <div className="preview image-preview">
      <div className="zoom-bar">
        <ZoomControls zoom={zoom} zoomIn={zoomIn} zoomOut={zoomOut} reset={reset} />
      </div>
      <div ref={body} className="image-preview-body">
        <AuthImage projectId={projectId} path={path} zoom={zoom} />
      </div>
    </div>
  );
}

/** Images need the Authorization header, so they load through fetch into a blob URL. */
function AuthImage({ projectId, path, zoom }: { projectId: string; path: string; zoom: number }) {
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
  return src ? (
    <img src={src} alt={path} style={{ transform: `scale(${zoom})`, transformOrigin: '0 0' }} />
  ) : null;
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
  const canComment = role !== 'viewer';
  const [hasSelection, setHasSelection] = useState(false);
  const requestCommentRef = useRef<(scope: CommentScope) => void>(() => {});
  const comments = useService(CommentServiceToken);
  const identity = useService(IdentityToken);
  const history = useService(HistoryServiceToken);
  const files = useService(FileServiceToken);
  const me = useMe().data;
  const [gone, setGone] = useState(false);
  const viewRef = useRef<EditorView | null>(null);
  const providerRef = useRef<HocuspocusProvider | null>(null);
  // Baseline text for the change gutter: the file at the last saved version ('' if new).
  const changeBase = useRef<string | null>(null);
  const { data: status } = useHistoryStatus(projectId);
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
  const queryClient = useQueryClient();
  const ytextRef = useRef<Y.Text | null>(null);
  const editorBoxRef = useRef<HTMLDivElement | null>(null);
  // True while the popup's own textarea has focus.
  const composingRef = useRef(false);
  // The round "add comment" button: shown (top, in px relative to .editor) while a selection exists.
  const [icon, setIcon] = useState<number | null>(null);
  const [popup, setPopup] = useState<{
    target: ComposerTarget;
    left: number;
    top: number;
  } | null>(null);
  const [popupBody, setPopupBody] = useState('');

  const closePopup = () => {
    viewRef.current?.dispatch({ effects: setComposerTarget.of(null) });
    composingRef.current = false;
    setPopup(null);
    setPopupBody('');
  };
  const createComment = useMutation({
    mutationFn: (input: NewComment) => comments.create(projectId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['comments', projectId] });
      closePopup();
    },
  });
  const submitPopup = () => {
    const target = popup?.target;
    const ytext = ytextRef.current;
    const state = viewRef.current?.state;
    const text = popupBody.trim();
    if (!target || !ytext || !state || !text || createComment.isPending) return;
    createComment.mutate({
      path,
      anchor: {
        start: encodeAnchorPos(ytext, target.from),
        end: encodeAnchorPos(ytext, target.to),
      },
      quote: state.sliceDoc(target.from, Math.min(target.to, target.from + 500)),
      line: state.doc.lineAt(target.from).number,
      body: text,
    });
  };

  const openBox = (scope: CommentScope) => {
    const view = viewRef.current;
    if (!view) return;
    const { from, to, head } = view.state.selection.main;
    const range = scopeRange({ text: view.state.doc.toString(), from, to, head }, scope);
    if (range && range.from < range.to) {
      view.dispatch({ effects: setComposerTarget.of({ scope, ...range }) });
    }
  };
  const closeAndRefocus = () => {
    closePopup();
    viewRef.current?.focus();
  };
  // Click outside the box (but not on the icon, which toggles it) or Escape closes it.
  const popupOpen = popup !== null;
  const popupTextRef = useRef<HTMLTextAreaElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: closePopup only touches refs and stable setters
  useEffect(() => {
    if (!popupOpen) return;
    popupTextRef.current?.focus();
    const onDown = (ev: MouseEvent) => {
      const el = ev.target as Element;
      if (!el.closest?.('.comment-popup, .comment-fab')) closePopup();
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') closeAndRefocus();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [popupOpen]);

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
    ytextRef.current = ytext;
    const wrap = new Compartment();
    const ro = new Compartment();
    setGone(false);
    const wrapping = (on: boolean) => (on ? EditorView.lineWrapping : []);
    let wordTimer: ReturnType<typeof setTimeout> | undefined;

    /** Builds a snapshot of `scope`'s target now, so it survives the user moving to the panel. */
    const buildDraft = (
      range: { from: number; to: number } | null,
      scope: CommentScope,
    ): CommentDraft => {
      const state = view.state;
      if (!range || range.from >= range.to) {
        return { valid: false, path, scope, reason: scopeEmptyReason(scope) };
      }
      return {
        valid: true,
        path,
        scope,
        anchor: {
          start: encodeAnchorPos(ytext, range.from),
          end: encodeAnchorPos(ytext, range.to),
        },
        quote: state.sliceDoc(range.from, Math.min(range.to, range.from + 500)),
        line: state.doc.lineAt(range.from).number,
        endLine: state.doc.lineAt(Math.max(range.to - 1, range.from)).number,
      };
    };
    const requestComment = (scope: CommentScope) => {
      const state = view.state;
      const sel = state.selection.main;
      const range = scopeRange(
        { text: state.doc.toString(), from: sel.from, to: sel.to, head: sel.head },
        scope,
      );
      useWorkspaceStore.getState().setCommentDraft(buildDraft(range, scope));
    };
    requestCommentRef.current = requestComment;
    const requestLineComment = (lineNumber: number) => {
      const state = view.state;
      const n = Math.min(Math.max(lineNumber, 1), state.doc.lines);
      const { from } = state.doc.line(n);
      const range = lineRangeAt(state.doc.toString(), from, from);
      useWorkspaceStore.getState().setCommentDraft(buildDraft(range, 'line'));
    };
    /** Positions the popup under the icon, clamped inside the `.editor` box (re-run on scroll). */
    const handleComposerTarget = (target: ComposerTarget | null, rect: ComposerRect | null) => {
      if (!target) {
        composingRef.current = false;
        setPopupBody('');
        setPopup(null);
        return;
      }
      const box = editorBoxRef.current?.getBoundingClientRect();
      if (!box) return;
      // No rect (line not rendered): keep the last position instead of jumping elsewhere.
      setPopup((prev) => {
        const pos = rect
          ? placePopup({ top: rect.top - box.top, bottom: rect.bottom - box.top }, box)
          : (prev ?? placePopup({ top: 0, bottom: 0 }, box));
        return { target, ...pos };
      });
    };
    const handleSelection = (s: SelectionAffordance | null) => {
      const box = editorBoxRef.current?.getBoundingClientRect();
      if (!s?.rect || !box) return setIcon(null);
      // Keep the button inside the editor even when the line is partly scrolled out.
      setIcon(Math.max(4, Math.min(s.rect.top - box.top, box.height - 32)));
    };
    const commentExtensions: Extension = canComment
      ? [
          commentGutter(requestLineComment),
          keymap.of(
            SCOPE_SHORTCUTS.map(({ scope, key }) => ({
              key,
              run: () => {
                requestComment(scope);
                return true;
              },
            })),
          ),
          commentComposer({ onTarget: handleComposerTarget }),
          selectionAffordance(handleSelection),
        ]
      : [];
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: ytext.toString(),
        extensions: [
          basicSetup,
          syntaxHighlighting(latexHighlight),
          editorTheme,
          wrap.of(wrapping(useSettingsStore.getState().lineWrapping)),
          ro.of(EditorState.readOnly.of(readOnly)),
          path.endsWith('.tex') ? latexSupport() : [],
          yCollab(ytext, provider.awareness),
          commentHighlights(ytext, commentsRef),
          changeGutter(changeBase),
          blameGutter(),
          commentExtensions,
          EditorView.updateListener.of((u) => {
            if (u.selectionSet || u.docChanged) {
              const sel = u.state.selection.main;
              setHasSelection(sel.from !== sel.to);
            }
            if (!u.docChanged) return;
            if (u.transactions.some(isLocalEdit)) useWorkspaceStore.getState().bumpDocVersion();
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
        const changes = diff(current, text, DIFF_LIMITS).map((c) => ({
          from: c.fromA,
          to: c.toA,
          insert: text.slice(c.fromB, c.toB),
        }));
        view.dispatch({ changes, userEvent: 'format' });
      },
      getText: () => view.state.doc.toString(),
    });
    store.setCheckCommentAnchor((anchor) => {
      const from = resolveAnchorPos(ytext, anchor.start);
      const to = resolveAnchorPos(ytext, anchor.end);
      return from !== null && to !== null && from < to;
    });
    const revealComment = (id: string) => {
      const c = commentsRef.current.find((x) => x.id === id);
      const pos = c ? resolveAnchorPos(ytext, c.anchor.start) : null;
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
    providerRef.current = provider;
    const onAwareness = () => {
      if (awareness)
        useWorkspaceStore
          .getState()
          .setPeers(
            peersFrom(awareness.getStates(), doc.clientID, awareness.getLocalState()?.user?.id),
          );
    };
    awareness?.on('change', onAwareness);
    provider.on('unsyncedChanges', ({ number }: { number: number }) =>
      markUnsynced(provider, number > 0),
    );
    // The server refuses or drops a document whose file was deleted or renamed (here or by a
    // collaborator): stop reconnecting and keep the text visible but frozen.
    let closed = false;
    const markGone = () => {
      if (closed) return;
      closed = true;
      provider.disconnect();
      markUnsynced(provider, false);
      view.dispatch({ effects: ro.reconfigure(EditorState.readOnly.of(true)) });
      setGone(true);
    };
    provider.on('authenticationFailed', markGone);
    // A per-document close (code 1000) also happens on server shutdown; only a vanished file counts.
    provider.on('close', ({ event }: { event: { code: number } }) => {
      if (event.code !== 1000) return;
      files
        .list(projectId)
        .then((list) => !list.some((f) => f.path === path) && markGone())
        .catch(() => {});
    });
    const unsubscribe = useWorkspaceStore.subscribe((s, prev) => {
      if (s.pendingLine !== null && s.pendingLine !== prev.pendingLine) revealLine(view);
      if (s.commentJump && s.commentJump !== prev.commentJump) revealComment(s.commentJump.id);
    });
    revealLine(view);
    return () => {
      closed = true;
      unsubscribe();
      unsubWrap();
      awareness?.off('change', onAwareness);
      useWorkspaceStore.getState().setPeers([]);
      clearTimeout(wordTimer);
      useWorkspaceStore.getState().setEditorCommands(null);
      useWorkspaceStore.getState().setWordCount(null);
      useWorkspaceStore.getState().setCheckCommentAnchor(null);
      viewRef.current = null;
      providerRef.current = null;
      ytextRef.current = null;
      composingRef.current = false;
      setIcon(null);
      setPopup(null);
      setPopupBody('');
      view.destroy();
      // Edits typed just before closing the tab would die with the provider.
      closeWhenSynced(provider, doc);
    };
  }, [projectId, path, readOnly, canComment, identity.token, files]);

  useEffect(() => {
    const text = baseText ?? null;
    changeBase.current = text;
    viewRef.current?.dispatch({ effects: setChangeBase.of(text) });
  }, [baseText]);

  const activeBlame = blameVisible(blameOn, blame) ? (blame ?? null) : null;

  useEffect(() => {
    viewRef.current?.dispatch({ effects: setBlame.of(activeBlame) });
  }, [activeBlame]);

  // Own cursor label; separate so a late /me answer does not rebuild the editor.
  useEffect(() => {
    const awareness = providerRef.current?.awareness;
    if (!awareness || !me) return;
    const color = peerColor(me.id);
    awareness.setLocalStateField('user', {
      id: me.id,
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
    <div className="editor" ref={editorBoxRef}>
      {canComment && (
        <div className="comment-toolbar" role="toolbar" aria-label="Comentar no editor">
          {SCOPE_SHORTCUTS.map(({ scope, hint }) => {
            if (scope === 'selection' && !hasSelection) return null;
            const Icon = SCOPE_ICON[scope];
            return (
              <button
                key={scope}
                type="button"
                className={`comment-toolbar-btn${scope === 'selection' ? ' comment-toolbar-btn-primary' : ''}`}
                title={`Comentar ${SCOPE_LABELS[scope].toLowerCase()} (${hint})`}
                onClick={() => requestCommentRef.current(scope)}
              >
                <Icon size={14} aria-hidden="true" />
                {SCOPE_LABELS[scope]}
              </button>
            );
          })}
        </div>
      )}
      {gone && (
        <p className="form-error" role="alert">
          Arquivo removido ou renomeado
        </p>
      )}
      <div ref={host} className="editor-host" data-blame={activeBlame ? '' : undefined} />
      <CommentMenu projectId={projectId} role={role} comments={data ?? []} />
      {canComment && icon !== null && (
        <button
          type="button"
          className="comment-fab"
          aria-label="Comentar seleção"
          title="Comentar seleção"
          style={{ top: `${icon}px` }}
          // Keep the editor's selection and focus; this is an action, not a caret move.
          onMouseDown={(ev) => ev.preventDefault()}
          onClick={() => (popup ? closePopup() : openBox('selection'))}
        >
          <MessageSquarePlus size={16} aria-hidden="true" />
        </button>
      )}
      {canComment && popup && (
        <div
          className="comment-popup"
          style={{ '--cp-left': `${popup.left}px`, '--cp-top': `${popup.top}px` } as CSSProperties}
        >
          <form
            className="comment-popup-form"
            aria-label="Novo comentário"
            onSubmit={(ev) => {
              ev.preventDefault();
              submitPopup();
            }}
          >
            <div className="comment-popup-head">
              <span className="comment-popup-scopes">
                {SCOPE_SHORTCUTS.map(({ scope }) => (
                  <button
                    key={scope}
                    type="button"
                    className="comment-popup-scope"
                    aria-pressed={popup.target.scope === scope}
                    onClick={() => openBox(scope)}
                  >
                    {SCOPE_LABELS[scope]}
                  </button>
                ))}
              </span>
              <button
                type="button"
                className="comment-popup-close"
                aria-label="Fechar"
                onClick={closeAndRefocus}
              >
                <X size={12} aria-hidden="true" />
              </button>
            </div>
            <textarea
              aria-label="Comentário"
              placeholder="Escrever um comentário"
              rows={2}
              maxLength={4000}
              ref={popupTextRef}
              value={popupBody}
              onFocus={() => {
                composingRef.current = true;
              }}
              onChange={(ev) => setPopupBody(ev.target.value)}
              onKeyDown={(ev) => {
                if (ev.key === 'Escape') {
                  ev.preventDefault();
                  ev.stopPropagation();
                  closeAndRefocus();
                }
              }}
            />
            <div className="comment-popup-actions">
              <Button variant="ghost" size="compact" type="button" onClick={closePopup}>
                Cancelar
              </Button>
              <Button
                variant="secondary"
                size="compact"
                type="submit"
                disabled={!popupBody.trim() || createComment.isPending}
              >
                Comentar
              </Button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
