import { randomUUID } from 'node:crypto';
import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import type { Project } from '../../projects/domain/project';
import type { ProjectStorage } from '../../projects/domain/project-storage';
import type { User } from '../../users/domain/user';
import type { Comment, NewComment } from '../domain/comment';
import type { CommentRepository } from '../domain/comment.repository';
import { CommentsService } from './comments.service';

const user = (name: string): User => ({
  id: randomUUID(),
  email: `${name}@example.com`,
  name,
  createdAt: new Date(),
});

class FakeComments implements CommentRepository {
  rows: Comment[] = [];

  async listForFile(projectId: string, path: string, includeResolved: boolean) {
    return this.rows.filter(
      (c) => c.projectId === projectId && c.path === path && (includeResolved || !c.resolved),
    );
  }
  async create(c: NewComment) {
    const row: Comment = {
      id: randomUUID(),
      projectId: c.projectId,
      path: c.path,
      author: { id: c.authorId, name: 'x' },
      anchor: c.anchor,
      quote: c.quote,
      line: c.line,
      body: c.body,
      resolved: false,
      createdAt: new Date(),
      replies: [],
    };
    this.rows.push(row);
    return row;
  }
  async findById(_projectId: string, id: string) {
    return this.rows.find((c) => c.id === id) ?? null;
  }
  async setResolved(_projectId: string, id: string, resolved: boolean) {
    const row = this.rows.find((c) => c.id === id);
    if (row) row.resolved = resolved;
    return row ?? null;
  }
  async delete(_projectId: string, id: string) {
    this.rows = this.rows.filter((c) => c.id !== id);
  }
  async addReply(commentId: string, authorId: string, body: string) {
    const reply = {
      id: randomUUID(),
      commentId,
      author: { id: authorId, name: 'x' },
      body,
      createdAt: new Date(),
    };
    this.rows.find((c) => c.id === commentId)?.replies.push(reply);
    return reply;
  }
  async deleteReply(commentId: string, replyId: string) {
    const row = this.rows.find((c) => c.id === commentId);
    if (row) row.replies = row.replies.filter((r) => r.id !== replyId);
  }
}

describe('CommentsService', () => {
  const owner = user('owner');
  const reviewer = user('reviewer');
  const editor = user('editor');
  const project = { id: randomUUID(), ownerId: owner.id } as Project;
  // Only `safe.resolve` is used; any relative path is accepted.
  const storage = {
    open: () => ({ safe: { resolve: () => '' } }),
  } as unknown as ProjectStorage;
  const input = {
    path: 'main.tex',
    anchor: { start: 'AAA=', end: 'BBB=' },
    quote: 'hello',
    line: 3,
    body: 'fix this',
  };

  const setup = () => new CommentsService(new FakeComments(), storage);

  it('lets a reviewer create, resolve and reopen', async () => {
    const service = setup();
    const comment = await service.create(project, reviewer, input);
    expect(comment.resolved).toBe(false);
    expect((await service.setResolved(project, comment.id, true)).resolved).toBe(true);
    expect(await service.list(project, 'main.tex', false)).toHaveLength(0);
    expect((await service.setResolved(project, comment.id, false)).resolved).toBe(false);
  });

  it('lets the author or the owner delete, but not another editor', async () => {
    const service = setup();
    const own = await service.create(project, reviewer, input);
    await expect(service.remove(project, editor, own.id)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await service.remove(project, reviewer, own.id);
    expect(await service.list(project, 'main.tex', true)).toHaveLength(0);

    const other = await service.create(project, reviewer, input);
    await service.remove(project, owner, other.id);
    expect(await service.list(project, 'main.tex', true)).toHaveLength(0);
  });

  it('applies the same delete rule to replies', async () => {
    const service = setup();
    const comment = await service.create(project, reviewer, input);
    const reply = await service.reply(project, reviewer, comment.id, 'ok');
    await expect(service.removeReply(project, editor, comment.id, reply.id)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await service.removeReply(project, owner, comment.id, reply.id);
  });
});
