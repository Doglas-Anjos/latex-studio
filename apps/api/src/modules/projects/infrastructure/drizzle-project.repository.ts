import { DATABASE, type Database } from '@latex-studio/core';
import { fileEdits, projectMembers, projects, users } from '@latex-studio/core/schema';
import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, getTableColumns, sql } from 'drizzle-orm';
import type { Project, ProjectRole, ProjectWithRole } from '../domain/project';
import type {
  Member,
  NewProject,
  ProjectPatch,
  ProjectRepository,
} from '../domain/project.repository';

@Injectable()
export class DrizzleProjectRepository implements ProjectRepository {
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

  listForUser(userId: string): Promise<ProjectWithRole[]> {
    return this.db
      .select({ ...getTableColumns(projects), role: projectMembers.role })
      .from(projects)
      .innerJoin(
        projectMembers,
        and(eq(projectMembers.projectId, projects.id), eq(projectMembers.userId, userId)),
      )
      .orderBy(desc(projects.createdAt));
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

  async markDirty(id: string): Promise<void> {
    await this.db.update(projects).set({ dirtySince: sql`now()` }).where(eq(projects.id, id));
  }

  async recordEdit(projectId: string, path: string, userId: string): Promise<void> {
    await this.db
      .insert(fileEdits)
      .values({ projectId, path, userId })
      .onConflictDoUpdate({
        target: [fileEdits.projectId, fileEdits.path, fileEdits.userId],
        set: { updatedAt: sql`now()` },
      });
  }
}
