import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { projectRole, projects } from './projects';
import { users } from './users';

/** Projects the host has shared on the local network (LAN share mode). A row = published. */
export const publishedProjects = pgTable('published_projects', {
  projectId: uuid('project_id')
    .primaryKey()
    .references(() => projects.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** A per-person LAN access: an alias, a role and the hashed 4-digit PIN the friend types to join. */
export const lanAccess = pgTable('lan_access', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id, { onDelete: 'cascade' }),
  // The real user row backing this access (name = alias), so presence/blame/history credit it.
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  alias: text('alias').notNull(),
  // What the friend may do while the project is published: editor, reviewer or viewer (never owner).
  role: projectRole('role').notNull().default('editor'),
  // scrypt `salt:hash` (hex); never the plaintext PIN.
  pinHash: text('pin_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastSeen: timestamp('last_seen', { withTimezone: true }),
});
