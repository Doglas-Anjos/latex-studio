import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useMe } from '../auth-hooks';
import { SCOPE_LABELS } from '../comment-scope';
import { useService } from '../di/service-provider';
import { CommentServiceToken } from '../services/comment.service';
import type { Role } from '../services/project.service';
import { useWorkspaceStore } from '../workspace-store';
import { Button } from './button';

const who = (a: { name: string } | null) => a?.name ?? 'Anônimo';

const scopeSummary = (line: number, endLine: number) =>
  line === endLine ? `linha ${line}` : `linhas ${line}–${endLine}`;

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
  const draft = useWorkspaceStore((s) => s.commentDraft);
  const setDraft = useWorkspaceStore((s) => s.setCommentDraft);
  const checkAnchor = useWorkspaceStore((s) => s.checkCommentAnchor);
  const setActivePath = useWorkspaceStore((s) => s.setActivePath);
  const activeId = useWorkspaceStore((s) => s.activeCommentId);
  const reveal = useWorkspaceStore((s) => s.revealComment);
  const [showResolved, setShowResolved] = useState(false);
  const [body, setBody] = useState('');
  const [staleError, setStaleError] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const focus = useWorkspaceStore((s) => s.commentFocus);
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
  const canEdit = (authorId: string | undefined) => canComment && !!me && me.id === authorId;

  // Double click / "Editar" in the editor: bring that comment into view, highlighted.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs per focus request, once the list is in
  useEffect(() => {
    if (!focus) return;
    const target = data.find((c) => c.id === focus.id);
    if (!target) return;
    listRef.current
      ?.querySelector(`[data-comment-id="${CSS.escape(focus.id)}"]`)
      ?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    if (focus.edit && canEdit(target.author?.id)) setEditing({ id: target.id, text: target.body });
  }, [focus, data.length]);

  // A new draft (even for the same scope) is a fresh attempt: drop any earlier staleness notice.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `draft` is the trigger, not read here.
  useEffect(() => setStaleError(false), [draft]);

  const draftOnThisFile = draft !== null && draft.path === path ? draft : null;
  const anchorStale =
    draftOnThisFile?.valid && checkAnchor !== null && !checkAnchor(draftOnThisFile.anchor);
  const canSubmit =
    canComment &&
    body.trim().length > 0 &&
    draftOnThisFile?.valid &&
    !anchorStale &&
    !run.isPending;

  const add = () => {
    const text = body.trim();
    if (!canSubmit || !draftOnThisFile?.valid || !text) return;
    if (checkAnchor && !checkAnchor(draftOnThisFile.anchor)) {
      setStaleError(true);
      return;
    }
    run.mutate(
      () =>
        service.create(projectId, {
          path,
          anchor: draftOnThisFile.anchor,
          quote: draftOnThisFile.quote,
          line: draftOnThisFile.line,
          body: text,
        }),
      {
        onSuccess: () => {
          setBody('');
          setDraft(null);
        },
      },
    );
  };

  return (
    <section className="comments-panel" aria-label="Comentários">
      <form
        className="comment-composer"
        onSubmit={(ev) => {
          ev.preventDefault();
          add();
        }}
      >
        {!draft && (
          <p className="comment-hint">
            Selecione um trecho no editor, ou use os controles de palavra, linha ou seção, para
            começar um comentário.
          </p>
        )}
        {draft && draft.path !== path && (
          <p className="comment-draft-note">
            Rascunho de comentário em <strong>{draft.path}</strong>.{' '}
            <Button variant="ghost" size="compact" onClick={() => setActivePath(draft.path)}>
              Abrir arquivo
            </Button>{' '}
            <Button variant="ghost" size="compact" onClick={() => setDraft(null)}>
              Descartar
            </Button>
          </p>
        )}
        {draftOnThisFile && !draftOnThisFile.valid && (
          <p className="comment-draft-note comment-draft-error">
            {draftOnThisFile.reason}{' '}
            <Button variant="ghost" size="compact" onClick={() => setDraft(null)}>
              Descartar
            </Button>
          </p>
        )}
        {draftOnThisFile?.valid && (
          <div className="comment-draft">
            <p className="comment-draft-meta">
              <span className="comment-draft-scope">{SCOPE_LABELS[draftOnThisFile.scope]}</span>
              <span>{scopeSummary(draftOnThisFile.line, draftOnThisFile.endLine)}</span>
              <Button variant="ghost" size="compact" type="button" onClick={() => setDraft(null)}>
                Cancelar
              </Button>
            </p>
            <blockquote className="comment-draft-quote">{draftOnThisFile.quote}</blockquote>
            {(anchorStale || staleError) && (
              <p className="comment-draft-error">
                O trecho selecionado não existe mais no texto atual. Refaça a seleção no editor.
              </p>
            )}
            <textarea
              aria-label="Comentário"
              placeholder="Escrever um comentário"
              rows={2}
              maxLength={4000}
              value={body}
              disabled={!canComment}
              onChange={(ev) => setBody(ev.target.value)}
            />
          </div>
        )}
        <Button variant="secondary" type="submit" disabled={!canSubmit}>
          Comentar
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
      <ul className="comment-list" ref={listRef}>
        {data.map((c) => (
          <li
            key={c.id}
            data-comment-id={c.id}
            className={`comment${c.id === activeId ? ' comment-active' : ''}${c.resolved ? ' comment-done' : ''}`}
          >
            <button type="button" className="comment-head" onClick={() => reveal(c.id)}>
              <strong>{who(c.author)}</strong>
              <blockquote className="comment-quote">{c.quote}</blockquote>
            </button>
            {editing?.id === c.id ? (
              <form
                className="comment-edit"
                onSubmit={(ev) => {
                  ev.preventDefault();
                  const text = editing.text.trim();
                  if (!text) return;
                  run.mutate(() => service.edit(projectId, c.id, text), {
                    onSuccess: () => setEditing(null),
                  });
                }}
              >
                <textarea
                  aria-label="Editar comentário"
                  rows={3}
                  maxLength={4000}
                  // biome-ignore lint/a11y/noAutofocus: the user just asked to edit this comment
                  autoFocus
                  value={editing.text}
                  onChange={(ev) => setEditing({ id: c.id, text: ev.target.value })}
                  onKeyDown={(ev) => {
                    if (ev.key === 'Escape') setEditing(null);
                  }}
                />
                <div className="comment-actions">
                  <Button
                    variant="primary"
                    size="compact"
                    type="submit"
                    disabled={!editing.text.trim()}
                  >
                    Salvar
                  </Button>
                  <Button variant="ghost" size="compact" onClick={() => setEditing(null)}>
                    Cancelar
                  </Button>
                </div>
              </form>
            ) : (
              <p className="comment-body">{c.body}</p>
            )}
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
              {canEdit(c.author?.id) && editing?.id !== c.id && (
                <Button variant="ghost" onClick={() => setEditing({ id: c.id, text: c.body })}>
                  Editar
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
