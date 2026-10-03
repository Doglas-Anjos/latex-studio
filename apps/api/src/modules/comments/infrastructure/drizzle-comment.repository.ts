import { DATABASE, type Database } from '@latex-studio/core';
import { commentReplies, comments, users } from '@latex-studio/core/schema';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, type SQL } from 'drizzle-orm';
import type { Author, Comment, NewComment, Reply } from '../domain/comment';
import type { CommentRepository } from '../domain/comment.repository';

const author = (id: string | null, name: string | null): Author =>
  id && name !== null ? { id, name } : null;

@Injectable()
export class DrizzleCommentRepository implements CommentRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async listForFile(projectId: string, path: string, includeResolved: boolean): Promise<Comment[]> {
    const where = and(
      eq(comments.projectId, projectId),
      eq(comments.path, path),
      includeResolved ? undefined : eq(comments.resolved, false),
    );
    return this.withReplies(await this.selectComments(where));
  }

  async create(c: NewComment): Promise<Comment> {
    const [row] = await this.db.insert(comments).values(c).returning({ id: comments.id });
    const created = row && (await this.findById(c.projectId, row.id));
    if (!created) throw new Error('Comment insert returned no row');
    return created;
  }

  async findById(projectId: string, id: string): Promise<Comment | null> {
    const rows = await this.selectComments(
      and(eq(comments.projectId, projectId), eq(comments.id, id)),
    );
    return (await this.withReplies(rows))[0] ?? null;
  }

  async setResolved(projectId: string, id: string, resolved: boolean): Promise<Comment | null> {
    await this.db
      .update(comments)
      .set({ resolved })
      .where(and(eq(comments.projectId, projectId), eq(comments.id, id)));
    return this.findById(projectId, id);
  }

  async delete(projectId: string, id: string): Promise<void> {
    await this.db
      .delete(comments)
      .where(and(eq(comments.projectId, projectId), eq(comments.id, id)));
  }

  async addReply(commentId: string, authorId: string, body: string): Promise<Reply> {
    const [row] = await this.db
      .insert(commentReplies)
      .values({ commentId, authorId, body })
      .returning({ id: commentReplies.id });
    const [reply] = row ? await this.selectReplies(eq(commentReplies.id, row.id)) : [];
    if (!reply) throw new Error('Reply insert returned no row');
    return reply;
  }

  async deleteReply(commentId: string, replyId: string): Promise<void> {
    await this.db
      .delete(commentReplies)
      .where(and(eq(commentReplies.commentId, commentId), eq(commentReplies.id, replyId)));
  }

  private async selectComments(where: SQL | undefined): Promise<Comment[]> {
    const rows = await this.db
      .select({ c: comments, authorName: users.name })
      .from(comments)
      .leftJoin(users, eq(users.id, comments.authorId))
      .where(where)
      .orderBy(asc(comments.createdAt));
    return rows.map(({ c, authorName }) => {
      const { authorId, ...rest } = c;
      return { ...rest, author: author(authorId, authorName), replies: [] };
    });
  }

  private async selectReplies(where: SQL | undefined): Promise<Reply[]> {
    const rows = await this.db
      .select({
        id: commentReplies.id,
        commentId: commentReplies.commentId,
        authorId: commentReplies.authorId,
        authorName: users.name,
        body: commentReplies.body,
        createdAt: commentReplies.createdAt,
      })
      .from(commentReplies)
      .leftJoin(users, eq(users.id, commentReplies.authorId))
      .where(where)
      .orderBy(asc(commentReplies.createdAt));
    return rows.map(({ authorId, authorName, ...r }) => ({
      ...r,
      author: author(authorId, authorName),
    }));
  }

  private async withReplies(list: Comment[]): Promise<Comment[]> {
    if (list.length === 0) return list;
    const ids = list.map((c) => c.id);
    const replies = await this.selectReplies(inArray(commentReplies.commentId, ids));
    for (const c of list) c.replies = replies.filter((r) => r.commentId === c.id);
    return list;
  }
}
