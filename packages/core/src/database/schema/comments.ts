import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { projects } from './projects';
import { users } from './users';

/** Serialized Yjs relative positions, so the anchor follows the text through other people's edits. */
export type CommentAnchor = { start: string; end: string };

export const comments = pgTable(
  'comments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    path: text('path').notNull(),
    authorId: uuid('author_id').references(() => users.id, { onDelete: 'set null' }),
    anchor: jsonb('anchor').$type<CommentAnchor>().notNull(),
    /** Fallback when the Yjs document is gone: the text that was selected and its line then. */
    quote: text('quote').notNull(),
    line: integer('line'),
    body: text('body').notNull(),
    resolved: boolean('resolved').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('comments_project_path_idx').on(t.projectId, t.path)],
);

export const commentReplies = pgTable(
  'comment_replies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    commentId: uuid('comment_id')
      .notNull()
      .references(() => comments.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id').references(() => users.id, { onDelete: 'set null' }),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('comment_replies_comment_id_idx').on(t.commentId)],
);
