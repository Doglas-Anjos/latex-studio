import type { Database } from '@latex-studio/core';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { expect, it } from 'vitest';
import { DrizzleProjectRepository } from './drizzle-project.repository';

// Autocommit clears the flag only `where dirtySince <= its start`; that guard needs every edit to
// move dirtySince forward, not just the first one.
it('markDirty always moves dirtySince forward', async () => {
  let where: SQL | undefined;
  const db = {
    update: () => ({
      set: () => ({
        where: async (w: SQL) => {
          where = w;
        },
      }),
    }),
  } as unknown as Database;
  await new DrizzleProjectRepository(db).markDirty('p1');
  const { sql } = new PgDialect().sqlToQuery(where as SQL);
  expect(sql).toBe('"projects"."id" = $1');
});
