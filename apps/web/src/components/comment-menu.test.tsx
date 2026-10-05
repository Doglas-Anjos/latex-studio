// @vitest-environment jsdom
import { act, cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Container } from '../di/container';
import { type AuthService, AuthServiceToken } from '../services/auth.service';
import {
  type Comment,
  type CommentService,
  CommentServiceToken,
} from '../services/comment.service';
import { renderWithApp } from '../test/render';
import { useWorkspaceStore } from '../workspace-store';
import { CommentMenu } from './comment-menu';
import { CommentsPanel } from './comments-panel';

const comment: Comment = {
  id: 'c1',
  projectId: 'p1',
  path: 'main.tex',
  author: { id: 'u1', name: 'Ana' },
  anchor: { start: 'AA==', end: 'AA==' },
  quote: 'trecho',
  line: 3,
  body: 'texto antigo',
  resolved: false,
  createdAt: '2026-01-01T00:00:00Z',
  replies: [],
};

const setup = (meId: string) => {
  const service = {
    list: vi.fn().mockResolvedValue([comment]),
    create: vi.fn(),
    setResolved: vi.fn(),
    edit: vi.fn().mockResolvedValue({ ...comment, body: 'texto novo' }),
    remove: vi.fn(),
    reply: vi.fn(),
    removeReply: vi.fn(),
  } as unknown as CommentService;
  const auth = { me: vi.fn().mockResolvedValue({ id: meId }) } as unknown as AuthService;
  renderWithApp(
    <>
      <CommentMenu projectId="p1" role="editor" comments={[comment]} />
      <CommentsPanel projectId="p1" path="main.tex" role="editor" />
    </>,
    new Container().register(CommentServiceToken, service).register(AuthServiceToken, auth),
  );
  return service;
};

describe('comment right-click menu and editing', () => {
  afterEach(() => {
    cleanup();
    useWorkspaceStore.getState().reset();
  });

  it('lets the author edit from the menu and saves the new text', async () => {
    const service = setup('u1');
    await screen.findByText('texto antigo');
    act(() => useWorkspaceStore.getState().setCommentMenu({ id: 'c1', x: 10, y: 10 }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Editar' }));
    const box = (await screen.findByRole('textbox', {
      name: 'Editar comentário',
    })) as HTMLTextAreaElement;
    await userEvent.clear(box);
    await userEvent.type(box, 'texto novo');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(service.edit).toHaveBeenCalledWith('p1', 'c1', 'texto novo'));
  });

  it('offers no edit to someone else', async () => {
    setup('u2');
    await screen.findByText('texto antigo');
    act(() => useWorkspaceStore.getState().setCommentMenu({ id: 'c1', x: 10, y: 10 }));
    expect(await screen.findByRole('menuitem', { name: 'Ver no painel' })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: 'Editar' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Editar' })).toBeNull();
  });
});
