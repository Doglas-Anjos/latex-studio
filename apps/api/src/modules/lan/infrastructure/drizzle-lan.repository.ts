import { DATABASE, type Database } from '@latex-studio/core';
import { lanAccess, publishedProjects } from '@latex-studio/core/schema';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import type { LanAccessRow, LanRepository, LanRole } from '../domain/lan.repository';

@Injectable()
export class DrizzleLanRepository implements LanRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async publish(projectId: string): Promise<void> {
    await this.db.insert(publishedProjects).values({ projectId }).onConflictDoNothing();
  }

  async unpublish(projectId: string): Promise<void> {
    await this.db.delete(publishedProjects).where(eq(publishedProjects.projectId, projectId));
  }

  async isPublished(projectId: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: publishedProjects.projectId })
      .from(publishedProjects)
      .where(eq(publishedProjects.projectId, projectId))
      .limit(1);
    return rows.length > 0;
  }

  async listPublished(): Promise<string[]> {
    const rows = await this.db.select({ id: publishedProjects.projectId }).from(publishedProjects);
    return rows.map((r) => r.id);
  }

  async createAccess(
    projectId: string,
    userId: string,
    alias: string,
    pinHash: string,
    role: LanRole,
  ): Promise<{ id: string }> {
    const [row] = await this.db
      .insert(lanAccess)
      .values({ projectId, userId, alias, pinHash, role })
      .returning({ id: lanAccess.id });
    if (!row) throw new Error('Failed to create LAN access');
    return { id: row.id };
  }

  async accessesOf(projectId: string): Promise<LanAccessRow[]> {
    const rows = await this.db.select().from(lanAccess).where(eq(lanAccess.projectId, projectId));
    // The column is the shared project_role enum; owner is never written (LanRole).
    return rows.map((r) => ({ ...r, role: r.role as LanRole }));
  }

  async accessRole(projectId: string, userId: string): Promise<LanRole | null> {
    const [row] = await this.db
      .select({ role: lanAccess.role })
      .from(lanAccess)
      .where(and(eq(lanAccess.projectId, projectId), eq(lanAccess.userId, userId)))
      .limit(1);
    return (row?.role as LanRole | undefined) ?? null;
  }

  async deleteAccess(projectId: string, id: string): Promise<void> {
    await this.db
      .delete(lanAccess)
      .where(and(eq(lanAccess.projectId, projectId), eq(lanAccess.id, id)));
  }

  async touchAccess(id: string): Promise<void> {
    await this.db.update(lanAccess).set({ lastSeen: sql`now()` }).where(eq(lanAccess.id, id));
  }
}
