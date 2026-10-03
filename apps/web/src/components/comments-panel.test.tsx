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

describe('CommentsPanel', () => {
  afterEach(cleanup);

  it('shows the comment and resolves it', async () => {
    const service: CommentService = {
      list: vi.fn().mockResolvedValue([comment]),
      create: vi.fn(),
      setResolved: vi.fn().mockResolvedValue({ ...comment, resolved: true }),
      remove: vi.fn(),
      reply: vi.fn(),
      removeReply: vi.fn(),
    };
    const auth = { me: vi.fn().mockResolvedValue({ id: 'u1' }) } as unknown as AuthService;
    renderWithApp(
      <CommentsPanel projectId="p1" path="main.tex" role={ROLE} />,
      new Container().register(CommentServiceToken, service).register(AuthServiceToken, auth),
    );
    expect(await screen.findByText('Ana')).toBeTruthy();
    expect(screen.getByText('Revisar este parágrafo')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Resolver' }));
    await waitFor(() => expect(service.setResolved).toHaveBeenCalledWith('p1', 'c1', true));
  });
});
