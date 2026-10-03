import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useMe } from '../auth-hooks';
import { useService } from '../di/service-provider';
import { CommentServiceToken } from '../services/comment.service';
import type { Role } from '../services/project.service';
import { useWorkspaceStore } from '../workspace-store';
import { Button } from './button';

const who = (a: { name: string } | null) => a?.name ?? 'Anônimo';

export function CommentsPanel({
  projectId,
  path,
  role,
}: {
  projectId: string;
  path: string;
  role: Role;
}) {
  const service = useService(CommentServiceToken);
  const queryClient = useQueryClient();
  const { data: me } = useMe();
  const getSelection = useWorkspaceStore((s) => s.getSelection);
  const activeId = useWorkspaceStore((s) => s.activeCommentId);
  const reveal = useWorkspaceStore((s) => s.revealComment);
  const [showResolved, setShowResolved] = useState(false);
  const [body, setBody] = useState('');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const canComment = role !== 'viewer';
  const { data = [] } = useQuery({
    queryKey: ['comments', projectId, path, showResolved],
    queryFn: () => service.list(projectId, path, showResolved),
  });
  const run = useMutation({
    mutationFn: (action: () => Promise<unknown>) => action(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['comments', projectId] }),
  });
  const canDelete = (authorId: string | undefined) =>
    role === 'owner' || (!!me && me.id === authorId);

  const add = () => {
    const sel = getSelection?.();
    const text = body.trim();
    if (!sel || !text) return;
    run.mutate(
      () =>
        service.create(projectId, {
          path,
          anchor: sel.anchor,
          quote: sel.quote,
          line: sel.line,
          body: text,
        }),
      { onSuccess: () => setBody('') },
    );
  };

  return (
    <section className="comments-panel" aria-label="Comentários">
      <form
        className="comment-form"
        onSubmit={(ev) => {
          ev.preventDefault();
          add();
        }}
      >
        <textarea
          aria-label="Comentário"
          placeholder="Comentar a seleção atual"
          rows={2}
          maxLength={4000}
          value={body}
          disabled={!canComment}
          onChange={(ev) => setBody(ev.target.value)}
        />
        <Button
          variant="secondary"
          type="submit"
          disabled={!canComment || !body.trim() || !getSelection || run.isPending}
        >
          Comentar seleção
        </Button>
      </form>
      <label className="comment-toggle">
        <input
          type="checkbox"
          checked={showResolved}
          onChange={(ev) => setShowResolved(ev.target.checked)}
        />
        Mostrar resolvidos
      </label>
      <ul className="comment-list">
        {data.map((c) => (
          <li
            key={c.id}
            className={`comment${c.id === activeId ? ' comment-active' : ''}${c.resolved ? ' comment-done' : ''}`}
          >
            <button type="button" className="comment-head" onClick={() => reveal(c.id)}>
              <strong>{who(c.author)}</strong>
              <blockquote className="comment-quote">{c.quote}</blockquote>
            </button>
            <p className="comment-body">{c.body}</p>
            <ul className="comment-replies">
              {c.replies.map((r) => (
                <li key={r.id}>
                  <strong>{who(r.author)}</strong> {r.body}
                  {canDelete(r.author?.id) && (
                    <Button
                      variant="ghost"
                      aria-label="Excluir resposta"
                      onClick={() => run.mutate(() => service.removeReply(projectId, c.id, r.id))}
                    >
                      ×
                    </Button>
                  )}
                </li>
              ))}
            </ul>
            {canComment && (
              <form
                className="comment-reply"
                onSubmit={(ev) => {
                  ev.preventDefault();
                  const text = drafts[c.id]?.trim();
                  if (!text) return;
                  run.mutate(() => service.reply(projectId, c.id, text));
                  setDrafts({ ...drafts, [c.id]: '' });
                }}
              >
                <input
                  aria-label="Responder"
                  placeholder="Responder"
                  maxLength={4000}
                  value={drafts[c.id] ?? ''}
                  onChange={(ev) => setDrafts({ ...drafts, [c.id]: ev.target.value })}
                />
              </form>
            )}
            <div className="comment-actions">
              {canComment && (
                <Button
                  variant="secondary"
                  onClick={() =>
                    run.mutate(() => service.setResolved(projectId, c.id, !c.resolved))
                  }
                >
                  {c.resolved ? 'Reabrir' : 'Resolver'}
                </Button>
              )}
              {canDelete(c.author?.id) && (
                <Button
                  variant="ghost"
                  onClick={() => run.mutate(() => service.remove(projectId, c.id))}
                >
                  Excluir
                </Button>
              )}
            </div>
          </li>
        ))}
        {data.length === 0 && <li className="comment-empty">Nenhum comentário.</li>}
      </ul>
      {run.error && <p className="form-error">{run.error.message}</p>}
    </section>
  );
}
