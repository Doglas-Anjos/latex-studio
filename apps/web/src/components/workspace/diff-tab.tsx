import { syntaxHighlighting } from '@codemirror/language';
import { MergeView } from '@codemirror/merge';
import { EditorState } from '@codemirror/state';
import { EditorView, lineNumbers } from '@codemirror/view';
import { useQuery } from '@tanstack/react-query';
import { latex } from 'codemirror-lang-latex';
import { useEffect, useRef } from 'react';
import { useService } from '../../di/service-provider';
import { FileServiceToken } from '../../services/file.service';
import { HistoryServiceToken } from '../../services/history.service';
import { latexHighlight } from '../editor-theme';

const short = (sha: string, none: string) => (sha === 'empty' ? none : sha.slice(0, 7));

export function DiffTab(props: { projectId: string; path: string; from: string; to: string }) {
  const { projectId, path, from, to } = props;
  const history = useService(HistoryServiceToken);
  const files = useService(FileServiceToken);
  const host = useRef<HTMLDivElement>(null);
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
    staleTime: Number.POSITIVE_INFINITY,
  });

  useEffect(() => {
    if (!data || !host.current) return;
    const extensions = [
      lineNumbers(),
      EditorState.readOnly.of(true),
      EditorView.editable.of(false),
      EditorView.lineWrapping,
      syntaxHighlighting(latexHighlight),
      ...(path.endsWith('.tex') ? [latex()] : []),
    ];
    const view = new MergeView({
      a: { doc: data.a, extensions },
      b: { doc: data.b, extensions },
      parent: host.current,
      highlightChanges: true,
      gutter: true,
      collapseUnchanged: { margin: 3, minSize: 4 },
    });
    return () => view.destroy();
  }, [data, path]);

  return (
    <div className="diff-tab-wrap">
      <p className="status-note">
        {path} · {short(from, 'base')} → {to === 'work' ? 'rascunho' : short(to, 'base')}
        {to === 'work' && ' · Instantâneo: o lado direito não acompanha edições ao vivo'}
      </p>
      {isPending && <p className="status-note">Carregando diferenças…</p>}
      {error && <p className="form-error">Erro ao carregar diferenças: {error.message}</p>}
      <div className="diff-tab" ref={host} />
    </div>
  );
}
