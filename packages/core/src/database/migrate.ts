import { join } from 'node:path';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import type { Database } from './database.module';

// dist/database -> packages/core/drizzle
const migrationsFolder = join(__dirname, '..', '..', 'drizzle');

export function runMigrations(db: Database) {
  return migrate(db, { migrationsFolder });
}
