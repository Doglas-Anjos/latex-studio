import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useMe } from '../auth-hooks';
import { useService } from '../di/service-provider';
import { type Comment, CommentServiceToken } from '../services/comment.service';
import type { Role } from '../services/project.service';
import { useWorkspaceStore } from '../workspace-store';

/** Right-click menu on a comment highlight in the editor. */
export function CommentMenu({
  projectId,
  role,
  comments,
}: {
  projectId: string;
  role: Role;
  comments: Comment[];
}) {
  const menu = useWorkspaceStore((s) => s.commentMenu);
  const setCommentMenu = useWorkspaceStore((s) => s.setCommentMenu);
  const focusComment = useWorkspaceStore((s) => s.focusComment);
  const service = useService(CommentServiceToken);
  const queryClient = useQueryClient();
  const { data: me } = useMe();
  const ref = useRef<HTMLDivElement>(null);
  const run = useMutation({
    mutationFn: (action: () => Promise<unknown>) => action(),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['comments', projectId] }),
  });

  useEffect(() => {
    if (!menu) return;
    ref.current?.querySelector('button')?.focus();
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setCommentMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setCommentMenu(null);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menu, setCommentMenu]);

  const comment = menu && comments.find((c) => c.id === menu.id);
  if (!menu || !comment) return null;
  const mine = !!me && comment.author?.id === me.id;
  const canComment = role !== 'viewer';
  const act = (action: () => Promise<unknown>) => {
    run.mutate(action);
    setCommentMenu(null);
  };

  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label="Ações do comentário"
      className="comment-menu"
      style={{
        left: Math.min(menu.x, window.innerWidth - 190),
        top: Math.min(menu.y, window.innerHeight - 170),
      }}
    >
      <button type="button" role="menuitem" onClick={() => focusComment(comment.id)}>
        Ver no painel
      </button>
      {mine && canComment && (
        <button type="button" role="menuitem" onClick={() => focusComment(comment.id, true)}>
          Editar
        </button>
      )}
      {canComment && (
        <button
          type="button"
          role="menuitem"
          onClick={() => act(() => service.setResolved(projectId, comment.id, !comment.resolved))}
        >
          {comment.resolved ? 'Reabrir' : 'Resolver'}
        </button>
      )}
      {(mine || role === 'owner') && (
        <button
          type="button"
          role="menuitem"
          className="danger"
          onClick={() => act(() => service.remove(projectId, comment.id))}
        >
          Excluir
        </button>
      )}
    </div>,
    document.body,
  );
}
