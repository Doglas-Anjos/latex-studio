import { createToken } from '../di/container';
import type { ApiClient } from './api-client';

export interface Author {
  id: string;
  name: string;
}

export interface Reply {
  id: string;
  author: Author | null;
  body: string;
  createdAt: string;
}

export interface Comment {
  id: string;
  projectId: string;
  path: string;
  author: Author | null;
  /** base64 of Y.encodeRelativePosition. */
  anchor: { start: string; end: string };
  quote: string;
  line: number | null;
  body: string;
  resolved: boolean;
  createdAt: string;
  replies: Reply[];
}

export interface NewComment {
  path: string;
  anchor: { start: string; end: string };
  quote: string;
  line?: number;
  body: string;
}

export interface CommentService {
  /** Open comments only, unless `includeResolved`. */
  list(projectId: string, path: string, includeResolved: boolean): Promise<Comment[]>;
  create(projectId: string, input: NewComment): Promise<Comment>;
  setResolved(projectId: string, id: string, resolved: boolean): Promise<Comment>;
  /** Rewrites the text; only the author may. */
  edit(projectId: string, id: string, body: string): Promise<Comment>;
  remove(projectId: string, id: string): Promise<void>;
  reply(projectId: string, id: string, body: string): Promise<Reply>;
  removeReply(projectId: string, id: string, replyId: string): Promise<void>;
}

export const CommentServiceToken = createToken<CommentService>('CommentService');

export class HttpCommentService implements CommentService {
  constructor(private readonly api: ApiClient) {}

  list(projectId: string, path: string, includeResolved: boolean) {
    const q = new URLSearchParams({ path });
    if (!includeResolved) q.set('resolved', 'false');
    return this.api.get<Comment[]>(`/projects/${projectId}/comments?${q}`);
  }

  create(projectId: string, input: NewComment) {
    return this.api.post<Comment>(`/projects/${projectId}/comments`, input);
  }

  setResolved(projectId: string, id: string, resolved: boolean) {
    return this.api.patch<Comment>(`/projects/${projectId}/comments/${id}`, { resolved });
  }

  edit(projectId: string, id: string, body: string) {
    return this.api.patch<Comment>(`/projects/${projectId}/comments/${id}`, { body });
  }

  remove(projectId: string, id: string) {
    return this.api.delete(`/projects/${projectId}/comments/${id}`);
  }

  reply(projectId: string, id: string, body: string) {
    return this.api.post<Reply>(`/projects/${projectId}/comments/${id}/replies`, { body });
  }

  removeReply(projectId: string, id: string, replyId: string) {
    return this.api.delete(`/projects/${projectId}/comments/${id}/replies/${replyId}`);
  }
}
