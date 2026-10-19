import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { projects } from './projects';

/** Projects the host has shared on the local network (LAN share mode). A row = published. */
export const publishedProjects = pgTable('published_projects', {
  projectId: uuid('project_id')
    .primaryKey()
    .references(() => projects.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** A per-person LAN editor access: an alias and the hashed 4-digit PIN the friend types to join. */
export const lanAccess = pgTable('lan_access', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  alias: text('alias').notNull(),
  // scrypt `salt:hash` (hex); never the plaintext PIN.
  pinHash: text('pin_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastSeen: timestamp('last_seen', { withTimezone: true }),
});
