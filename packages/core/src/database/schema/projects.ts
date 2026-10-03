import { sql } from 'drizzle-orm';
import {
  check,
  index,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './users';

export const projectEngine = pgEnum('project_engine', ['pdflatex', 'xelatex', 'lualatex']);
export const projectRole = pgEnum('project_role', ['owner', 'editor', 'reviewer', 'viewer']);

export const projects = pgTable(
  'projects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    mainFile: text('main_file').notNull().default('main.tex'),
    engine: projectEngine('engine').notNull().default('pdflatex'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    // Set when a collaborative edit was flushed to disk and not yet committed (autocommit job).
    dirtySince: timestamp('dirty_since', { withTimezone: true }),
  },
  (t) => [check('projects_name_length', sql`char_length(${t.name}) between 1 and 100`)],
);

export const projectMembers = pgTable(
  'project_members',
  {
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: projectRole('role').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.userId] }),
    index('project_members_user_id_idx').on(t.userId),
  ],
);
