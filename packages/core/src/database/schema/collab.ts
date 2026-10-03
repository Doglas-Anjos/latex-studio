import { customType, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { projects } from './projects';

const bytea = customType<{ data: Uint8Array; driverData: Uint8Array }>({
  dataType: () => 'bytea',
});

/** Persisted Yjs state, one document per text file open in the collaborative editor. */
export const yjsDocs = pgTable(
  'yjs_docs',
  {
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    path: text('path').notNull(),
    state: bytea('state').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.path] })],
);
