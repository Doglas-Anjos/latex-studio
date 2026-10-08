import { DATABASE, type Database } from '@latex-studio/core';
import { fileEdits, projectMembers, projects, users } from '@latex-studio/core/schema';
import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, getTableColumns, inArray, lte, ne, sql } from 'drizzle-orm';
import type { Project, ProjectRole } from '../domain/project';
import type {
  Member,
  NewProject,
  ProjectListOptions,
  ProjectListPage,
  ProjectPatch,
  ProjectRepository,
} from '../domain/project.repository';

// ponytail: folds Portuguese accents only; enable the unaccent extension if other scripts matter.
const ACCENTED = 'áàâãäéèêëíìîïóòôõöúùûüç';
const PLAIN = 'aaaaaeeeeiiiiooooouuuuc';
const EDIT_THROTTLE_MS = 10_000;
const editKey = (projectId: string, path: string, userId: string) =>
  JSON.stringify([projectId, path, userId]);

@Injectable()
export class DrizzleProjectRepository implements ProjectRepository {
  /** When each (project, path, user) row was last written by `recordEdit`. */
  private readonly lastEdit = new Map<string, number>();

  constructor(@Inject(DATABASE) private readonly db: Database) {}

  create(project: NewProject, ownerId: string): Promise<Project> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(projects)
        .values({ ...project, ownerId })
        .returning();
      if (!row) throw new Error('Project insert returned no row');
      await tx.insert(projectMembers).values({ projectId: row.id, userId: ownerId, role: 'owner' });
      return row;
    });
  }

  listMembers(projectId: string): Promise<Member[]> {
    return this.db
      .select({ userId: users.id, name: users.name, email: users.email, role: projectMembers.role })
      .from(projectMembers)
      .innerJoin(users, eq(users.id, projectMembers.userId))
      .where(eq(projectMembers.projectId, projectId))
      .orderBy(users.name);
  }

  async setMember(projectId: string, userId: string, role: ProjectRole): Promise<void> {
    await this.db
      .insert(projectMembers)
      .values({ projectId, userId, role })
      .onConflictDoUpdate({
        target: [projectMembers.projectId, projectMembers.userId],
        set: { role },
      });
  }

  async removeMember(projectId: string, userId: string): Promise<void> {
    await this.db
      .delete(projectMembers)
      .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)));
  }

  async findById(id: string): Promise<Project | null> {
    const [row] = await this.db.select().from(projects).where(eq(projects.id, id));
    return row ?? null;
  }

  async listPageForUser(userId: string, options: ProjectListOptions): Promise<ProjectListPage> {
    const membership = and(
      eq(projectMembers.projectId, projects.id),
      eq(projectMembers.userId, userId),
    );
    const matches = and(
      options.filter === 'mine'
        ? eq(projectMembers.role, 'owner')
        : options.filter === 'shared'
          ? ne(projectMembers.role, 'owner')
          : undefined,
      options.search
        ? sql<boolean>`position(${options.search} in translate(lower(${projects.name}), ${ACCENTED}, ${PLAIN})) > 0`
        : undefined,
    );
    const [countRow] = await this.db
      .select({ n: count() })
      .from(projects)
      .innerJoin(projectMembers, membership)
      .where(matches);

    // Drizzle returns JS Dates at millisecond precision. Sort at the same precision as the cursor,
    // then use the UUID as a tie breaker so rows with identical timestamps are never skipped.
    const sortedAt = sql`date_trunc('milliseconds', ${projects.updatedAt})`;
    const after = options.cursor;
    const rows = await this.db
      .select({ ...getTableColumns(projects), role: projectMembers.role })
      .from(projects)
      .innerJoin(projectMembers, membership)
      .where(
        and(
          matches,
          after
            ? sql<boolean>`(${sortedAt}, ${projects.id}) < (${after.updatedAt}::timestamptz, ${after.id}::uuid)`
            : undefined,
        ),
      )
      .orderBy(desc(sortedAt), desc(projects.id))
      .limit(options.limit + 1);
    const items = rows.slice(0, options.limit);
    const last = items.at(-1);
    return {
      items,
      total: countRow?.n ?? 0,
      next:
        rows.length > options.limit && last
          ? { updatedAt: last.updatedAt.toISOString(), id: last.id }
          : null,
    };
  }

  async roleOf(projectId: string, userId: string): Promise<ProjectRole | null> {
    const [row] = await this.db
      .select({ role: projectMembers.role })
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)));
    return row?.role ?? null;
  }

  async countForUser(userId: string): Promise<number> {
    const [row] = await this.db
      .select({ n: count() })
      .from(projects)
      .where(eq(projects.ownerId, userId));
    return row?.n ?? 0;
  }

  async update(id: string, patch: ProjectPatch): Promise<Project> {
    const [row] = await this.db
      .update(projects)
      .set({ ...patch, updatedAt: sql`now()` })
      .where(eq(projects.id, id))
      .returning();
    if (!row) throw new Error('Project not found');
    return row;
  }

  async delete(id: string): Promise<void> {
    await this.db.delete(projects).where(eq(projects.id, id));
  }

  /** Called on every Yjs update; one row write per (file, user) every 10 s is plenty. */
  async recordEdit(projectId: string, path: string, userId: string): Promise<void> {
    const key = editKey(projectId, path, userId);
    const now = Date.now();
    if ((this.lastEdit.get(key) ?? 0) > now - EDIT_THROTTLE_MS) return;
    this.lastEdit.set(key, now);
    if (this.lastEdit.size > 10_000) this.lastEdit.clear();
    await this.db
      .insert(fileEdits)
      .values({ projectId, path, userId })
      .onConflictDoUpdate({
        target: [fileEdits.projectId, fileEdits.path, fileEdits.userId],
        set: { updatedAt: sql`now()` },
      });
  }

  async withEditors<T>(
    projectId: string,
    paths: string[] | null,
    commit: (editors: Array<{ name: string; email: string }>) => Promise<T>,
  ): Promise<T> {
    const where = and(
      eq(fileEdits.projectId, projectId),
      paths ? inArray(fileEdits.path, paths) : undefined,
    );
    const rows = await this.db
      .select({
        path: fileEdits.path,
        userId: fileEdits.userId,
        name: users.name,
        email: users.email,
        // As text: a JS Date drops the microseconds, and `<=` would then miss the newest row.
        upTo: sql<string>`(max(${fileEdits.updatedAt}) over ())::text`,
      })
      .from(fileEdits)
      .innerJoin(users, eq(users.id, fileEdits.userId))
      .where(where);
    const editors = new Map(rows.map(({ name, email }) => [email, { name, email }]));
    const result = await commit([...editors.values()]);
    if (rows.length === 0) return result;
    // A row written since the read has a later updated_at and stays for the next commit.
    const upTo = sql`${rows[0]?.upTo}::timestamptz`;
    await this.db.delete(fileEdits).where(and(where, lte(fileEdits.updatedAt, upTo)));
    // Or the throttle would skip the first edit after this commit, leaving no row for it.
    for (const r of rows) this.lastEdit.delete(editKey(projectId, r.path, r.userId));
    return result;
  }
}
