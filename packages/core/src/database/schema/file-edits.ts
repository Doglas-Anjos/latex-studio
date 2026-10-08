import { pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { projects } from './projects';
import { users } from './users';

/** Who edited which file collaboratively since it was last committed; the commit names them. */
export const fileEdits = pgTable(
  'file_edits',
  {
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    path: text('path').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.path, t.userId] })],
);
