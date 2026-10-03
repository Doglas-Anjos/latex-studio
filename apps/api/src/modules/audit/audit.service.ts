import { DATABASE, type Database, desc } from '@latex-studio/core';
import { auditLog } from '@latex-studio/core/schema';
import { Inject, Injectable, Logger } from '@nestjs/common';

export type AuditEntry = typeof auditLog.$inferSelect;

/** Append-only trail of security-relevant actions. Recording never fails the caller's request. */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async record(
    actorId: string | null,
    action: string,
    target?: string,
    details?: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.db.insert(auditLog).values({ actorId, action, target, details });
    } catch (e) {
      this.logger.error(`audit ${action} failed: ${(e as Error).message}`);
    }
  }

  list(limit: number): Promise<AuditEntry[]> {
    return this.db.select().from(auditLog).orderBy(desc(auditLog.createdAt)).limit(limit);
  }
}
