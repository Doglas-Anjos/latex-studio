import type { Comment, NewComment, Reply } from './comment';

export const COMMENT_REPOSITORY = Symbol('COMMENT_REPOSITORY');

export interface CommentRepository {
  /** Oldest first, replies included (oldest first). */
  listForFile(projectId: string, path: string, includeResolved: boolean): Promise<Comment[]>;
  create(comment: NewComment): Promise<Comment>;
  findById(projectId: string, id: string): Promise<Comment | null>;
  setResolved(projectId: string, id: string, resolved: boolean): Promise<Comment | null>;
  delete(projectId: string, id: string): Promise<void>;
  addReply(commentId: string, authorId: string, body: string): Promise<Reply>;
  deleteReply(commentId: string, replyId: string): Promise<void>;
}
