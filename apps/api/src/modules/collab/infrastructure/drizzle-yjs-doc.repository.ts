import { DATABASE, type Database } from '@latex-studio/core';
import { yjsDocs } from '@latex-studio/core/schema';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { YjsDocRepository } from '../domain/yjs-doc.repository';

@Injectable()
export class DrizzleYjsDocRepository implements YjsDocRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async load(projectId: string, path: string): Promise<Uint8Array | null> {
    const [row] = await this.db
      .select({ state: yjsDocs.state })
      .from(yjsDocs)
      .where(and(eq(yjsDocs.projectId, projectId), eq(yjsDocs.path, path)));
    return row?.state ?? null;
  }

  async save(projectId: string, path: string, state: Uint8Array): Promise<void> {
    await this.db
      .insert(yjsDocs)
      .values({ projectId, path, state })
      .onConflictDoUpdate({
        target: [yjsDocs.projectId, yjsDocs.path],
        set: { state, updatedAt: new Date() },
      });
  }

  async deleteForPath(projectId: string, path: string): Promise<void> {
    await this.db
      .delete(yjsDocs)
      .where(and(eq(yjsDocs.projectId, projectId), eq(yjsDocs.path, path)));
  }
}
