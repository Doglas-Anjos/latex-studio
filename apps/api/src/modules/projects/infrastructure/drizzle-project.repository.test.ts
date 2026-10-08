import type { Database } from '@latex-studio/core';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { expect, it } from 'vitest';
import { DrizzleProjectRepository } from './drizzle-project.repository';

it('withEditors clears only the rows it read, and only after the commit went through', async () => {
  const calls: string[] = [];
  let cleared: SQL | undefined;
  const upTo = '2026-10-08 10:00:00.123456+00';
  const rows = [
    { path: 'a.tex', userId: 'u2', name: 'Bruno', email: 'b@x.com', upTo },
    { path: 'b.tex', userId: 'u2', name: 'Bruno', email: 'b@x.com', upTo },
  ];
  const db = {
    select: () => ({ from: () => ({ innerJoin: () => ({ where: async () => rows }) }) }),
    delete: () => ({
      where: async (where: SQL) => {
        calls.push('delete');
        cleared = where;
      },
    }),
  } as unknown as Database;
  const repo = new DrizzleProjectRepository(db);

  const sha = await repo.withEditors('p1', ['a.tex', 'b.tex'], async (editors) => {
    calls.push(`commit ${editors.map((e) => e.name).join(',')}`);
    return 'sha';
  });

  expect(sha).toBe('sha');
  expect(calls).toEqual(['commit Bruno', 'delete']);
  const { sql, params } = new PgDialect().sqlToQuery(cleared as SQL);
  expect(sql).toBe(
    '(("file_edits"."project_id" = $1 and "file_edits"."path" in ($2, $3)) and "file_edits"."updated_at" <= $4::timestamptz)',
  );
  expect(params).toEqual(['p1', 'a.tex', 'b.tex', upTo]);

  // A commit that throws clears nothing.
  const failed = repo.withEditors('p1', null, async () => {
    throw new Error('git');
  });
  await expect(failed).rejects.toThrow('git');
  expect(calls).toHaveLength(2);
});
