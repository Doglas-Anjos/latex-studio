import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { projectEngine, projects } from './projects';
import { users } from './users';

export const buildStatus = pgEnum('build_status', [
  'queued',
  'running',
  'succeeded',
  'failed',
  'timeout',
  'cancelled',
]);

/** Per-build compile options chosen by the requester. */
export type BuildOptions = { draft?: boolean; haltOnError?: boolean };

export type LogEntry = { file?: string; line?: number; message: string };

/** One compile request; the PDF, log and synctex live under BUILDS_DIR/<projectId>/<id>/. */
export const builds = pgTable(
  'builds',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    requestedBy: uuid('requested_by').references(() => users.id, { onDelete: 'set null' }),
    status: buildStatus('status').notNull().default('queued'),
    engine: projectEngine('engine').notNull(),
    mainFile: text('main_file').notNull(),
    commitSha: text('commit_sha'),
    exitCode: integer('exit_code'),
    errors: jsonb('errors').$type<LogEntry[]>().notNull().default([]),
    warnings: jsonb('warnings').$type<LogEntry[]>().notNull().default([]),
    /** Over/underfull boxes and other typographic notes. */
    info: jsonb('info').$type<LogEntry[]>().notNull().default([]),
    options: jsonb('options').$type<BuildOptions>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [
    index('builds_project_id_created_at_idx').on(t.projectId, t.createdAt),
    // At most one queued build per project: concurrent compile requests dedupe on insert.
    uniqueIndex('builds_one_queued_per_project').on(t.projectId).where(sql`${t.status} = 'queued'`),
  ],
);
