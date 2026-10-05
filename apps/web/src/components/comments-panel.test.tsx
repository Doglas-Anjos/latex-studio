// @vitest-environment jsdom
import { cleanup, screen, waitFor } from '@testing-library/react';
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
import type { CommentDraft } from '../workspace-store';
import { useWorkspaceStore } from '../workspace-store';
import { CommentsPanel } from './comments-panel';

const ROLE = 'reviewer' as const;
const comment: Comment = {
  id: 'c1',
  projectId: 'p1',
  path: 'main.tex',
  author: { id: 'u1', name: 'Ana' },
  anchor: { start: 'AA==', end: 'AA==' },
  quote: 'trecho citado',
  line: 3,
  body: 'Revisar este parágrafo',
  resolved: false,
  createdAt: '2026-01-01T00:00:00Z',
  replies: [],
};

const emptyService = (): CommentService => ({
  list: vi.fn().mockResolvedValue([]),
  create: vi.fn().mockResolvedValue({ ...comment, id: 'c2' }),
  setResolved: vi.fn(),
  remove: vi.fn(),
  reply: vi.fn(),
  removeReply: vi.fn(),
});
const authFor = (id: string) =>
  ({ me: vi.fn().mockResolvedValue({ id }) }) as unknown as AuthService;
const submitButton = () => screen.getByRole('button', { name: 'Comentar' }) as HTMLButtonElement;

describe('CommentsPanel', () => {
  afterEach(() => {
    cleanup();
    useWorkspaceStore.getState().setCommentDraft(null);
    useWorkspaceStore.getState().setCheckCommentAnchor(null);
  });

  it('shows the comment and resolves it', async () => {
    const service: CommentService = {
      list: vi.fn().mockResolvedValue([comment]),
      create: vi.fn(),
      setResolved: vi.fn().mockResolvedValue({ ...comment, resolved: true }),
      remove: vi.fn(),
      reply: vi.fn(),
      removeReply: vi.fn(),
    };
    renderWithApp(
      <CommentsPanel projectId="p1" path="main.tex" role={ROLE} />,
      new Container()
        .register(CommentServiceToken, service)
        .register(AuthServiceToken, authFor('u1')),
    );
    expect(await screen.findByText('Ana')).toBeTruthy();
    expect(screen.getByText('Revisar este parágrafo')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Resolver' }));
    await waitFor(() => expect(service.setResolved).toHaveBeenCalledWith('p1', 'c1', true));
  });

  it('without a draft, explains how to start one and disables submit', async () => {
    const service = emptyService();
    renderWithApp(
      <CommentsPanel projectId="p1" path="main.tex" role={ROLE} />,
      new Container()
        .register(CommentServiceToken, service)
        .register(AuthServiceToken, authFor('u1')),
    );
    expect(await screen.findByText(/Selecione um trecho no editor/)).toBeTruthy();
    expect(submitButton().disabled).toBe(true);
  });

  it('shows scope, line and quote for a valid draft, and submits it as-is', async () => {
    const service = emptyService();
    useWorkspaceStore.getState().setCommentDraft({
      valid: true,
      path: 'main.tex',
      scope: 'section',
      anchor: { start: 'AA==', end: 'AQ==' },
      quote: '\\section{Intro}\nfoo',
      line: 1,
      endLine: 2,
    });
    const { container } = renderWithApp(
      <CommentsPanel projectId="p1" path="main.tex" role={ROLE} />,
      new Container()
        .register(CommentServiceToken, service)
        .register(AuthServiceToken, authFor('u1')),
    );
    expect(await screen.findByText('Seção')).toBeTruthy();
    expect(screen.getByText('linhas 1–2')).toBeTruthy();
    expect(container.querySelector('.comment-draft-quote')?.textContent).toBe(
      '\\section{Intro}\nfoo',
    );
    expect(submitButton().disabled).toBe(true);
    await userEvent.type(screen.getByLabelText('Comentário'), 'Explicar a introdução');
    expect(submitButton().disabled).toBe(false);
    await userEvent.click(submitButton());
    await waitFor(() =>
      expect(service.create).toHaveBeenCalledWith('p1', {
        path: 'main.tex',
        anchor: { start: 'AA==', end: 'AQ==' },
        quote: '\\section{Intro}\nfoo',
        line: 1,
        body: 'Explicar a introdução',
      }),
    );
    // Sent: the draft is cleared, back to the "start a comment" hint.
    await waitFor(() => expect(screen.queryByText('Seção')).toBeNull());
  });

  it('shows a clear reason and keeps submit disabled for an invalid draft', async () => {
    const service = emptyService();
    useWorkspaceStore.getState().setCommentDraft({
      valid: false,
      path: 'main.tex',
      scope: 'word',
      reason: 'Posicione o cursor sobre uma palavra.',
    });
    renderWithApp(
      <CommentsPanel projectId="p1" path="main.tex" role={ROLE} />,
      new Container()
        .register(CommentServiceToken, service)
        .register(AuthServiceToken, authFor('u1')),
    );
    expect(await screen.findByText('Posicione o cursor sobre uma palavra.')).toBeTruthy();
    expect(submitButton().disabled).toBe(true);
  });

  it('offers to open the file when the draft belongs to another one', async () => {
    const service = emptyService();
    const draft: CommentDraft = {
      valid: true,
      path: 'other.tex',
      scope: 'line',
      anchor: { start: 'AA==', end: 'AQ==' },
      quote: 'x',
      line: 1,
      endLine: 1,
    };
    useWorkspaceStore.getState().setCommentDraft(draft);
    renderWithApp(
      <CommentsPanel projectId="p1" path="main.tex" role={ROLE} />,
      new Container()
        .register(CommentServiceToken, service)
        .register(AuthServiceToken, authFor('u1')),
    );
    expect(await screen.findByText('other.tex')).toBeTruthy();
    expect(submitButton().disabled).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: 'Abrir arquivo' }));
    expect(useWorkspaceStore.getState().activePath).toBe('other.tex');
  });

  it('flags a draft whose anchor no longer resolves and blocks submit', async () => {
    const service = emptyService();
    useWorkspaceStore.getState().setCommentDraft({
      valid: true,
      path: 'main.tex',
      scope: 'word',
      anchor: { start: 'AA==', end: 'AQ==' },
      quote: 'stale',
      line: 1,
      endLine: 1,
    });
    useWorkspaceStore.getState().setCheckCommentAnchor(() => false);
    renderWithApp(
      <CommentsPanel projectId="p1" path="main.tex" role={ROLE} />,
      new Container()
        .register(CommentServiceToken, service)
        .register(AuthServiceToken, authFor('u1')),
    );
    expect(await screen.findByText(/não existe mais no texto atual/)).toBeTruthy();
    await userEvent.type(screen.getByLabelText('Comentário'), 'tarde demais');
    expect(submitButton().disabled).toBe(true);
    expect(service.create).not.toHaveBeenCalled();
  });
});
