import { syntaxHighlighting } from '@codemirror/language';
import { MergeView, unifiedMergeView } from '@codemirror/merge';
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView, lineNumbers } from '@codemirror/view';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Undo2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { yCollab } from 'y-codemirror.next';
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
const MODES: [ViewMode, string][] = [
  ['split', 'Lado a lado'],
  ['unified', 'Unificado'],
  ['words', 'Palavras'],
];
const COLLAB_EXT = /\.(tex|bib|sty|cls|txt|md|json)$/i;
const REVERT_TITLE = 'Desfazer esta mudança: volta ao texto anterior';

// Two columns need real width to stay readable; narrower than this, fold
// into a single annotated column instead of squeezing both.
const SPLIT_MIN_WIDTH = 720;

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

/** Hand-drawn Undo2 (lucide) for controls CodeMirror renders outside React. */
const UNDO_SVG =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11"/></svg>';

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
 * cursor others should see.
 */
function useLiveText(projectId: string, path: string, enabled: boolean) {
  const identity = useService(IdentityToken);
  const [ytext, setYtext] = useState<Y.Text | null>(null);
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
    const yt = doc.getText('content');
    let timer: ReturnType<typeof setTimeout> | undefined;
    const update = () => {
      clearTimeout(timer);
      timer = setTimeout(() => setText(yt.toString()), 250);
    };
    provider.on('synced', () => {
      setText(yt.toString());
      setYtext(yt);
      yt.observe(update);
    });
    return () => {
      clearTimeout(timer);
      yt.unobserve(update);
      setYtext(null);
      closeWhenSynced(provider, doc);
    };
  }, [projectId, path, enabled, identity]);
  return { ytext, text };
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
  const [wide, setWide] = useState(true);
  // The user's explicit pick always wins; otherwise the mode follows width.
  const [modeOverride, setModeOverride] = useState<ViewMode | null>(null);
  const mode: ViewMode = modeOverride ?? (wide ? 'split' : 'unified');
  const liveWanted = to === 'work' && COLLAB_EXT.test(path);
  const live = useLiveText(projectId, path, liveWanted);
  const editable = canEdit && !!live.ytext;

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width !== undefined) setWide(width >= SPLIT_MIN_WIDTH);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

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
  const ready = !!data && (!liveWanted || !!live.ytext);

  useEffect(() => {
    if (!ready || !data || mode === 'words' || !host.current) return;
    const ytext = live.ytext;
    const b = ytext ? ytext.toString() : data.b;
    const readOnly = [EditorState.readOnly.of(true), EditorView.editable.of(false)];
    const base: Extension[] = [
      editorTheme,
      diffColors,
      lineNumbers(),
      EditorView.lineWrapping,
      syntaxHighlighting(latexHighlight),
      ...(path.endsWith('.tex') ? [latexSupport()] : []),
    ];
    // The new side is the live document when there is one: reverts and edits sync like typing.
    const bSide = [
      ...base,
      ...(ytext ? [yCollab(ytext, null)] : []),
      ...(editable ? [] : readOnly),
    ];
    const view =
      mode === 'split'
        ? new MergeView({
            a: { doc: data.a, extensions: [...base, ...readOnly] },
            b: { doc: b, extensions: bSide },
            parent: host.current,
            highlightChanges: true,
            gutter: true,
            collapseUnchanged: { margin: 3, minSize: 4 },
            diffConfig: DIFF_LIMITS,
            ...(editable && {
              revertControls: 'a-to-b',
              renderRevertControl: () => revertButton(),
            }),
          })
        : new EditorView({
            state: EditorState.create({
              doc: b,
              extensions: [
                ...bSide,
                unifiedMergeView({
                  original: data.a,
                  highlightChanges: true,
                  gutter: true,
                  // Only "reject" (undo the change) means something here; "accept" would just
                  // move this view's baseline, so it is not offered.
                  mergeControls: editable
                    ? (type, action) => {
                        if (type === 'accept') return document.createElement('span');
                        const button = revertButton('Desfazer');
                        button.onmousedown = action;
                        return button;
                      }
                    : false,
                  collapseUnchanged: { margin: 3, minSize: 4 },
                  diffConfig: DIFF_LIMITS,
                }),
              ],
            }),
            parent: host.current,
          });
    return () => view.destroy();
  }, [ready, data, live.ytext, editable, path, mode]);

  const revertWords = (p: Extract<WordPart, { type: 'change' }>) => {
    const ytext = live.ytext;
    if (!ytext) return;
    ytext.doc?.transact(() => {
      // The text may have moved since this render; only undo what is still there.
      if (ytext.toString().slice(p.fromB, p.toB) !== p.added) return;
      ytext.delete(p.fromB, p.toB - p.fromB);
      ytext.insert(p.fromB, p.removed);
    });
  };

  return (
    <div className="diff-tab-wrap" ref={wrapRef}>
      <div className="diff-tab-header">
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
        <span className="diff-legend" aria-hidden="true">
          <span className="diff-legend-del">saiu</span>
          <span className="diff-legend-ins">entrou</span>
        </span>
        <fieldset className="view-toggle">
          <legend className="sr-only">Modo de comparação</legend>
          {MODES.map(([m, label]) => (
            <button
              key={m}
              type="button"
              className="view-toggle-btn"
              aria-pressed={mode === m}
              onClick={() => setModeOverride(m)}
            >
              {label}
            </button>
          ))}
        </fieldset>
      </div>
      {(isPending || (liveWanted && !live.ytext)) && (
        <p className="status-note">Carregando diferenças…</p>
      )}
      {error && <p className="form-error">Erro ao carregar diferenças: {error.message}</p>}
      {mode === 'words' ? (
        ready &&
        data && (
          <WordDiffView
            a={data.a}
            b={live.ytext ? live.text : data.b}
            onRevert={editable ? revertWords : undefined}
          />
        )
      ) : (
        <div className="diff-tab-body" ref={host} />
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
