import { sql } from 'drizzle-orm';
import { check, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

/**
 * One row per person the authenticator in front vouched for. `issuer` + `subject` is the stable
 * identity (two issuers may reuse a `sub`); email and name are refreshed from the token.
 */
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    issuer: text('issuer').notNull(),
    subject: text('subject').notNull(),
    email: text('email').notNull().unique(),
    name: text('name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('users_issuer_subject_idx').on(t.issuer, t.subject),
    check('users_email_lowercase', sql`${t.email} = lower(${t.email})`),
  ],
);
