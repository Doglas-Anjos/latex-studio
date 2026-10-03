import type { CommentAnchor } from '@latex-studio/core/schema';

export type Author = { id: string; name: string } | null;

export interface Reply {
  id: string;
  commentId: string;
  author: Author;
  body: string;
  createdAt: Date;
}

export interface Comment {
  id: string;
  projectId: string;
  path: string;
  author: Author;
  anchor: CommentAnchor;
  quote: string;
  line: number | null;
  body: string;
  resolved: boolean;
  createdAt: Date;
  replies: Reply[];
}

export interface NewComment {
  projectId: string;
  path: string;
  authorId: string;
  anchor: CommentAnchor;
  quote: string;
  line: number | null;
  body: string;
}
