import { DATABASE, type Database } from '@latex-studio/core';
import { projectMembers, projects } from '@latex-studio/core/schema';
import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, getTableColumns } from 'drizzle-orm';
import type { Project, ProjectRole, ProjectWithRole } from '../domain/project';
import type { NewProject, ProjectRepository } from '../domain/project.repository';

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

  async delete(id: string): Promise<void> {
    await this.db.delete(projects).where(eq(projects.id, id));
  }
}
