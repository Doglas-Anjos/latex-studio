import { syntaxHighlighting } from '@codemirror/language';
import { getChunks, MergeView, unifiedMergeView } from '@codemirror/merge';
import {
  EditorState,
  type Extension,
  RangeSetBuilder,
  StateEffect,
  StateField,
} from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, keymap, lineNumbers } from '@codemirror/view';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  Columns2,
  type LucideIcon,
  Redo2,
  Rows2,
  Undo2,
  WholeWord,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { yCollab, yUndoManagerKeymap } from 'y-codemirror.next';
import * as Y from 'yjs';
import { useService } from '../../di/service-provider';
import { FileServiceToken } from '../../services/file.service';
import { HistoryServiceToken } from '../../services/history.service';
import { IdentityToken } from '../../services/identity';
import { closeWhenSynced } from '../editor';
import { DIFF_LIMITS } from '../editor-changes';
import { editorTheme, latexHighlight } from '../editor-theme';
import { latexSupport } from '../latex-language';
import { type WordPart, wordDiff } from '../word-diff';
import { basename } from './tab-bar';

const short = (sha: string, none: string) => (sha === 'empty' ? none : sha.slice(0, 7));

type ViewMode = 'split' | 'unified' | 'words';
const MODES: { mode: ViewMode; label: string; Icon: LucideIcon }[] = [
  { mode: 'split', label: 'Lado a lado', Icon: Columns2 },
  { mode: 'unified', label: 'Unificado', Icon: Rows2 },
  { mode: 'words', label: 'Palavras', Icon: WholeWord },
];
const COLLAB_EXT = /\.(tex|bib|sty|cls|txt|md|json)$/i;
const REVERT_TITLE = 'Desfazer esta mudança: volta ao texto anterior';

// Two columns need real width: from this width the split is the default, and under the
// minimum it is not offered at all (each column would be a few words wide).
const SPLIT_DEFAULT_WIDTH = 720;
const SPLIT_MIN_WIDTH = 560;

const phrases = EditorState.phrases.of({
  '$ unchanged lines': '$ linhas sem mudança',
  Accept: 'Aceitar',
  Reject: 'Desfazer',
  'Revert this chunk': REVERT_TITLE,
});

/** Removed text in red with a strike, added text in green: the same code in every mode. */
const diffColors = EditorView.theme({
  '&.cm-merge-a .cm-changedLine, .cm-deletedChunk': { backgroundColor: 'var(--diff-del-line)' },
  '&.cm-merge-b .cm-changedLine, .cm-inlineChangedLine': {
    backgroundColor: 'var(--diff-ins-line)',
  },
  '&.cm-merge-a .cm-changedText, .cm-deletedChunk .cm-deletedText': {
    background: 'var(--diff-del-word)',
    color: 'var(--diff-del-ink)',
    textDecoration: 'line-through',
    textDecorationThickness: '1.5px',
  },
  '&.cm-merge-b .cm-changedText, .cm-inlineChangedLine .cm-changedText': {
    background: 'var(--diff-ins-word)',
    color: 'var(--diff-ins-ink)',
  },
  '&.cm-merge-a .cm-changedLineGutter, .cm-deletedLineGutter': {
    background: 'var(--diff-del-ink)',
  },
  '&.cm-merge-b .cm-changedLineGutter, .cm-inlineChangedLineGutter': {
    background: 'var(--diff-ins-ink)',
  },
});

/**
 * Lines a hovered undo button would touch, so the person sees the effect before clicking: on the
 * new side they are about to go, on the old side they are about to come back. Any edit clears it
 * (the button that set it may be gone without a mouseleave).
 */
const setPreview = StateEffect.define<{ from: number; to: number } | null>();
const previewLines = (cls: string) =>
  StateField.define<DecorationSet>({
    create: () => Decoration.none,
    update(deco, tr) {
      let next = tr.docChanged ? Decoration.none : deco;
      for (const e of tr.effects) {
        if (!e.is(setPreview)) continue;
        const builder = new RangeSetBuilder<Decoration>();
        const doc = tr.state.doc;
        if (e.value) {
          for (let pos = e.value.from; pos < e.value.to && pos <= doc.length; ) {
            const line = doc.lineAt(pos);
            builder.add(line.from, line.from, Decoration.line({ class: cls }));
            pos = line.to + 1;
          }
        }
        next = builder.finish();
      }
      return next;
    },
    provide: (f) => EditorView.decorations.from(f),
  });
const goingLines = previewLines('cm-revertGoing');
const comingLines = previewLines('cm-revertComing');

/** Hand-drawn Undo2 (lucide) for controls CodeMirror renders outside React. */
const UNDO_SVG =
  '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11"/></svg>';

function revertButton(label?: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'diff-revert';
  b.title = REVERT_TITLE;
  b.setAttribute('aria-label', REVERT_TITLE);
  b.innerHTML = UNDO_SVG + (label ? `<span>${label}</span>` : '');
  return b;
}

/**
 * The working copy's live Yjs text, so the diff follows edits and a revert lands in the real
 * document (and reaches collaborators) instead of a snapshot. No awareness: the diff tab is not a
 * cursor others should see. One undo history serves every mode, for "Refazer" and Ctrl+Z.
 */
function useLiveText(projectId: string, path: string, enabled: boolean) {
  const identity = useService(IdentityToken);
  const [live, setLive] = useState<{ ytext: Y.Text; undo: Y.UndoManager } | null>(null);
  const [text, setText] = useState('');
  useEffect(() => {
    if (!enabled) return;
    const doc = new Y.Doc();
    const provider = new HocuspocusProvider({
      url: `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/collab`,
      name: `${projectId}/${path}`,
      document: doc,
      token: async () => (await identity.token()) ?? '',
    });
    const ytext = doc.getText('content');
    let undo: Y.UndoManager | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const update = () => {
      clearTimeout(timer);
      timer = setTimeout(() => setText(ytext.toString()), 250);
    };
    provider.on('synced', () => {
      if (undo) return; // a reconnect syncs again
      undo = new Y.UndoManager(ytext);
      setText(ytext.toString());
      setLive({ ytext, undo });
      ytext.observe(update);
    });
    return () => {
      clearTimeout(timer);
      if (undo) {
        ytext.unobserve(update);
        undo.destroy();
      }
      setLive(null);
      closeWhenSynced(provider, doc);
    };
  }, [projectId, path, enabled, identity]);
  return { ytext: live?.ytext ?? null, undo: live?.undo ?? null, text };
}

export function DiffTab(props: {
  projectId: string;
  path: string;
  from: string;
  to: string;
  canEdit: boolean;
}) {
  const { projectId, path, from, to, canEdit } = props;
  const history = useService(HistoryServiceToken);
  const files = useService(FileServiceToken);
  const wrapRef = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(Number.POSITIVE_INFINITY);
  const splitTooNarrow = width < SPLIT_MIN_WIDTH;
  // The user's explicit pick wins, except a split with no room for two columns.
  const [modeOverride, setModeOverride] = useState<ViewMode | null>(null);
  const mode: ViewMode =
    modeOverride === 'split' && splitTooNarrow
      ? 'unified'
      : (modeOverride ?? (width >= SPLIT_DEFAULT_WIDTH ? 'split' : 'unified'));
  const liveWanted = to === 'work' && COLLAB_EXT.test(path);
  const live = useLiveText(projectId, path, liveWanted);
  const { ytext, undo } = live;
  const editable = canEdit && !!ytext;
  const [reverted, setReverted] = useState(0); // bumps on every undo click; 0 = no notice

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w !== undefined) setWidth(w);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!reverted) return;
    const timer = setTimeout(() => setReverted(0), 8000);
    return () => clearTimeout(timer);
  }, [reverted]);

  const { data, error, isPending } = useQuery({
    queryKey: ['diff', projectId, path, from, to, liveWanted],
    queryFn: async () => {
      const [a, b] = await Promise.all([
        from === 'empty' ? '' : history.file(projectId, from, path),
        liveWanted
          ? '' // comes from the live doc
          : to === 'work'
            ? files.blob(projectId, path).then((blob) => blob.text())
            : history.file(projectId, to, path),
      ]);
      return { a, b };
    },
    // A commit never changes; the working copy does, so reopening it refetches.
    staleTime: to === 'work' ? 0 : Number.POSITIVE_INFINITY,
  });
  const ready = !!data && (!liveWanted || !!ytext);

  useEffect(() => {
    if (!ready || !data || mode === 'words' || !host.current) return;
    const b = ytext ? ytext.toString() : data.b;
    const readOnly = [EditorState.readOnly.of(true), EditorView.editable.of(false)];
    const base: Extension[] = [
      editorTheme,
      diffColors,
      phrases,
      lineNumbers(),
      EditorView.lineWrapping,
      syntaxHighlighting(latexHighlight),
      ...(path.endsWith('.tex') ? [latexSupport()] : []),
    ];
    // The new side is the live document when there is one: reverts and edits sync like typing.
    const bSide = [
      ...base,
      goingLines,
      ...(ytext && undo ? [yCollab(ytext, null, { undoManager: undo })] : []),
      ...(editable ? [keymap.of(yUndoManagerKeymap)] : readOnly),
    ];
    // A revert is its own undo step, never merged with typing just before it.
    const beforeRevert = () => undo?.stopCapturing();
    const afterRevert = () => setTimeout(() => setReverted((n) => n + 1));

    let merge: MergeView | null = null;
    const splitControl = () => {
      const button = revertButton();
      const chunk = () => {
        const i = Array.prototype.indexOf.call(button.parentElement?.children ?? [], button);
        return merge?.chunks[i];
      };
      button.addEventListener('mouseenter', () => {
        const c = chunk();
        if (!c || !merge) return;
        merge.a.dispatch({ effects: setPreview.of({ from: c.fromA, to: c.toA }) });
        merge.b.dispatch({ effects: setPreview.of({ from: c.fromB, to: c.toB }) });
      });
      button.addEventListener('mouseleave', () => {
        merge?.a.dispatch({ effects: setPreview.of(null) });
        merge?.b.dispatch({ effects: setPreview.of(null) });
      });
      // Runs before MergeView's own mousedown handler on the gap, which applies the revert.
      button.addEventListener('mousedown', () => {
        beforeRevert();
        afterRevert();
      });
      return button;
    };

    let unified: EditorView | null = null;
    const unifiedControl = (type: 'accept' | 'reject', action: (e: MouseEvent) => void) => {
      // "Accept" would only move this view's baseline, so it is not offered.
      if (type === 'accept') return document.createElement('span');
      const button = revertButton('Desfazer');
      const block = () => button.closest('.cm-deletedChunk');
      button.addEventListener('mouseenter', () => {
        if (!unified) return;
        const pos = unified.posAtDOM(button);
        const c = getChunks(unified.state)?.chunks.find((ch) => ch.fromB <= pos && pos <= ch.endB);
        block()?.classList.add('cm-revertComing');
        if (c) unified.dispatch({ effects: setPreview.of({ from: c.fromB, to: c.toB }) });
      });
      button.addEventListener('mouseleave', () => {
        block()?.classList.remove('cm-revertComing');
        unified?.dispatch({ effects: setPreview.of(null) });
      });
      button.onmousedown = (e) => {
        beforeRevert();
        action(e);
        afterRevert();
      };
      return button;
    };

    if (mode === 'split') {
      merge = new MergeView({
        a: { doc: data.a, extensions: [...base, comingLines, ...readOnly] },
        b: { doc: b, extensions: bSide },
        parent: host.current,
        highlightChanges: true,
        gutter: true,
        collapseUnchanged: { margin: 3, minSize: 4 },
        diffConfig: DIFF_LIMITS,
        ...(editable && { revertControls: 'a-to-b', renderRevertControl: splitControl }),
      });
      const view = merge;
      return () => view.destroy();
    }
    unified = new EditorView({
      state: EditorState.create({
        doc: b,
        extensions: [
          ...bSide,
          unifiedMergeView({
            original: data.a,
            highlightChanges: true,
            gutter: true,
            mergeControls: editable ? unifiedControl : false,
            collapseUnchanged: { margin: 3, minSize: 4 },
            diffConfig: DIFF_LIMITS,
          }),
        ],
      }),
      parent: host.current,
    });
    const view = unified;
    return () => view.destroy();
  }, [ready, data, ytext, undo, editable, path, mode]);

  const revertWords = (p: Extract<WordPart, { type: 'change' }>) => {
    if (!ytext) return;
    undo?.stopCapturing();
    ytext.doc?.transact(() => {
      // The text may have moved since this render; only undo what is still there.
      if (ytext.toString().slice(p.fromB, p.toB) !== p.added) return;
      ytext.delete(p.fromB, p.toB - p.fromB);
      ytext.insert(p.fromB, p.removed);
    });
    setReverted((n) => n + 1);
  };

  return (
    <div className="diff-tab-wrap" ref={wrapRef}>
      <div className="diff-tab-header">
        <span className="diff-tab-file">
          <span className="diff-tab-path" title={path}>
            {basename(path)}
          </span>
          <span className="diff-tab-revs">
            <span className="diff-tab-rev">{short(from, 'base')}</span>
            <span aria-hidden="true">→</span>
            <span className="diff-tab-rev">{to === 'work' ? 'rascunho' : short(to, 'base')}</span>
          </span>
          {to === 'work' && !liveWanted && (
            <span
              className="diff-tab-snapshot"
              title="Instantâneo: o lado direito não acompanha edições ao vivo"
            >
              <AlertTriangle size={14} aria-hidden="true" />
            </span>
          )}
        </span>
        <span className="diff-legend" aria-hidden="true">
          <span className="diff-legend-del">saiu</span>
          <span className="diff-legend-ins">entrou</span>
        </span>
        <fieldset className="diff-modes">
          <legend className="sr-only">Modo de comparação</legend>
          {MODES.map(({ mode: m, label, Icon }) => {
            const blocked = m === 'split' && splitTooNarrow;
            return (
              <button
                key={m}
                type="button"
                className="diff-mode"
                aria-pressed={mode === m}
                aria-label={label}
                title={
                  blocked
                    ? 'Lado a lado precisa de mais largura: amplie esta área ou oculte o PDF'
                    : label
                }
                disabled={blocked}
                onClick={() => setModeOverride(m)}
              >
                <Icon size={14} aria-hidden="true" />
                <span className="diff-mode-label">{label}</span>
              </button>
            );
          })}
        </fieldset>
      </div>
      {(isPending || (liveWanted && !ytext)) && (
        <p className="status-note">Carregando diferenças…</p>
      )}
      {error && <p className="form-error">Erro ao carregar diferenças: {error.message}</p>}
      {mode === 'words' ? (
        ready &&
        data && (
          <WordDiffView
            a={data.a}
            b={ytext ? live.text : data.b}
            onRevert={editable ? revertWords : undefined}
          />
        )
      ) : (
        <div className="diff-tab-body" ref={host} />
      )}
      {reverted > 0 && (
        <div className="diff-toast" role="status">
          <Undo2 size={15} aria-hidden="true" />
          <span>Mudança desfeita.</span>
          <button
            type="button"
            className="diff-toast-action"
            onClick={() => {
              undo?.undo();
              setReverted(0);
            }}
          >
            <Redo2 size={14} aria-hidden="true" />
            Refazer
          </button>
          <button
            type="button"
            className="diff-toast-close"
            aria-label="Fechar aviso"
            onClick={() => setReverted(0)}
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
}

/** Lines of unchanged text kept around each change; longer runs fold into a button. */
const CONTEXT = 2;

/**
 * Prose view: the new text as it reads, with removed words struck through on a red band and
 * added words on green, like tracked changes in a word processor. Hovering a change offers undo.
 */
export function WordDiffView({
  a,
  b,
  onRevert,
}: {
  a: string;
  b: string;
  onRevert?: ((part: Extract<WordPart, { type: 'change' }>) => void) | undefined;
}) {
  const parts = useMemo(() => wordDiff(a, b, DIFF_LIMITS), [a, b]);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const count = parts.filter((p) => p.type === 'change').length;
  if (count === 0) return <p className="status-note">Nenhuma palavra mudou.</p>;
  return (
    <div className="word-diff-wrap">
      <p className="word-diff-count">
        {count === 1 ? '1 trecho alterado' : `${count} trechos alterados`}
      </p>
      <div className="word-diff">
        {parts.map((p, i) => {
          if (p.type === 'same') {
            const lines = p.text.split('\n');
            const head = i === 0 ? 0 : CONTEXT + 1;
            const tail = i === parts.length - 1 ? 0 : CONTEXT + 1;
            if (expanded.has(i) || lines.length <= head + tail + 2) {
              // biome-ignore lint/suspicious/noArrayIndexKey: parts are positional and rebuilt whole
              return <span key={i}>{p.text}</span>;
            }
            const hidden = lines.length - head - tail;
            return (
              // biome-ignore lint/suspicious/noArrayIndexKey: parts are positional and rebuilt whole
              <span key={i}>
                {head > 0 && `${lines.slice(0, head).join('\n')}\n`}
                <button
                  type="button"
                  className="word-diff-fold"
                  onClick={() => setExpanded(new Set(expanded).add(i))}
                >
                  ⋯ {hidden} linhas sem mudança
                </button>
                {tail > 0 && `\n${lines.slice(-tail).join('\n')}`}
              </span>
            );
          }
          const ws = (s: string) => /^\s+$/.test(s);
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: parts are positional and rebuilt whole
            <span key={i} className="wd-change">
              {p.removed && <del className="wd-del">{ws(p.removed) ? '¶' : p.removed}</del>}
              {p.added && <ins className="wd-ins">{ws(p.added) ? `¶${p.added}` : p.added}</ins>}
              {onRevert && (
                <button
                  type="button"
                  className="wd-revert"
                  title={REVERT_TITLE}
                  onClick={() => onRevert(p)}
                >
                  <Undo2 size={13} aria-hidden="true" />
                  Desfazer
                </button>
              )}
            </span>
          );
        })}
      </div>
    </div>
  );
}
