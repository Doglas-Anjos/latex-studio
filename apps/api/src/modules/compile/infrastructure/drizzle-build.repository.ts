import { DATABASE, type Database } from '@latex-studio/core';
import { builds } from '@latex-studio/core/schema';
import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, inArray } from 'drizzle-orm';
import type { Build, BuildRepository, NewBuild } from '../domain/build.repository';

@Injectable()
export class DrizzleBuildRepository implements BuildRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async create(build: NewBuild): Promise<Build> {
    // builds_one_queued_per_project: a concurrent request already queued one, so return that.
    const [row] = await this.db.insert(builds).values(build).onConflictDoNothing().returning();
    const existing = row ?? (await this.findActive(build.projectId));
    if (!existing) throw new Error('Build insert returned no row');
    return existing;
  }

  async findById(projectId: string, buildId: string): Promise<Build | null> {
    const [row] = await this.db
      .select()
      .from(builds)
      .where(and(eq(builds.id, buildId), eq(builds.projectId, projectId)));
    return row ?? null;
  }

  listForProject(projectId: string, limit: number): Promise<Build[]> {
    return this.db
      .select()
      .from(builds)
      .where(eq(builds.projectId, projectId))
      .orderBy(desc(builds.createdAt))
      .limit(limit);
  }

  async findActive(projectId: string): Promise<Build | null> {
    const [row] = await this.db
      .select()
      .from(builds)
      .where(and(eq(builds.projectId, projectId), inArray(builds.status, ['queued', 'running'])))
      .orderBy(desc(builds.createdAt))
      .limit(1);
    return row ?? null;
  }

  async countQueuedForUser(userId: string): Promise<number> {
    const [row] = await this.db
      .select({ n: count() })
      .from(builds)
      .where(and(eq(builds.requestedBy, userId), eq(builds.status, 'queued')));
    return row?.n ?? 0;
  }
}
