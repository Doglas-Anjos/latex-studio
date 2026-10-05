import { syntaxHighlighting } from '@codemirror/language';
import { MergeView, unifiedMergeView } from '@codemirror/merge';
import { EditorState } from '@codemirror/state';
import { EditorView, lineNumbers } from '@codemirror/view';
import { useQuery } from '@tanstack/react-query';
import { latex } from 'codemirror-lang-latex';
import { AlertTriangle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useService } from '../../di/service-provider';
import { FileServiceToken } from '../../services/file.service';
import { HistoryServiceToken } from '../../services/history.service';
import { DIFF_LIMITS } from '../editor-changes';
import { editorTheme, latexHighlight } from '../editor-theme';
import { basename } from './tab-bar';

const short = (sha: string, none: string) => (sha === 'empty' ? none : sha.slice(0, 7));

type ViewMode = 'split' | 'unified';

// Two columns need real width to stay readable; narrower than this, fold
// into a single annotated column instead of squeezing both.
const SPLIT_MIN_WIDTH = 720;

export function DiffTab(props: { projectId: string; path: string; from: string; to: string }) {
  const { projectId, path, from, to } = props;
  const history = useService(HistoryServiceToken);
  const files = useService(FileServiceToken);
  const wrapRef = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const [wide, setWide] = useState(true);
  // The user's explicit pick always wins; otherwise the mode follows width.
  const [modeOverride, setModeOverride] = useState<ViewMode | null>(null);
  const mode: ViewMode = modeOverride ?? (wide ? 'split' : 'unified');

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
    queryKey: ['diff', projectId, path, from, to],
    queryFn: async () => {
      const [a, b] = await Promise.all([
        from === 'empty' ? '' : history.file(projectId, from, path),
        to === 'work'
          ? files.blob(projectId, path).then((blob) => blob.text())
          : history.file(projectId, to, path),
      ]);
      return { a, b };
    },
    // A commit never changes; the working copy does, so reopening it refetches.
    staleTime: to === 'work' ? 0 : Number.POSITIVE_INFINITY,
  });

  useEffect(() => {
    if (!data || !host.current) return;
    const extensions = [
      editorTheme,
      lineNumbers(),
      EditorState.readOnly.of(true),
      EditorView.editable.of(false),
      EditorView.lineWrapping,
      syntaxHighlighting(latexHighlight),
      ...(path.endsWith('.tex') ? [latex()] : []),
    ];
    const view =
      mode === 'split'
        ? new MergeView({
            a: { doc: data.a, extensions },
            b: { doc: data.b, extensions },
            parent: host.current,
            highlightChanges: true,
            gutter: true,
            collapseUnchanged: { margin: 3, minSize: 4 },
            diffConfig: DIFF_LIMITS,
          })
        : new EditorView({
            state: EditorState.create({
              doc: data.b,
              extensions: [
                ...extensions,
                unifiedMergeView({
                  original: data.a,
                  highlightChanges: true,
                  gutter: true,
                  mergeControls: false,
                  collapseUnchanged: { margin: 3, minSize: 4 },
                  diffConfig: DIFF_LIMITS,
                }),
              ],
            }),
            parent: host.current,
          });
    return () => view.destroy();
  }, [data, path, mode]);

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
        {to === 'work' && (
          <span
            className="diff-tab-snapshot"
            title="Instantâneo: o lado direito não acompanha edições ao vivo"
          >
            <AlertTriangle size={14} aria-hidden="true" />
          </span>
        )}
        <fieldset className="view-toggle">
          <legend className="sr-only">Modo de comparação</legend>
          <button
            type="button"
            className="view-toggle-btn"
            aria-pressed={mode === 'split'}
            onClick={() => setModeOverride('split')}
          >
            Lado a lado
          </button>
          <button
            type="button"
            className="view-toggle-btn"
            aria-pressed={mode === 'unified'}
            onClick={() => setModeOverride('unified')}
          >
            Unificado
          </button>
        </fieldset>
      </div>
      {isPending && <p className="status-note">Carregando diferenças…</p>}
      {error && <p className="form-error">Erro ao carregar diferenças: {error.message}</p>}
      <div className="diff-tab-body" ref={host} />
    </div>
  );
}
