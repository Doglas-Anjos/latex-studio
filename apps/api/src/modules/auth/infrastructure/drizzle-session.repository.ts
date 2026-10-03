import { DATABASE, type Database } from '@latex-studio/core';
import { sessions } from '@latex-studio/core/schema';
import { Inject, Injectable } from '@nestjs/common';
import { eq, lte } from 'drizzle-orm';
import type { Session, SessionRepository } from '../domain/session.repository';

@Injectable()
export class DrizzleSessionRepository implements SessionRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async create(session: Session): Promise<void> {
    await this.db.insert(sessions).values(session);
  }

  async findByTokenHash(tokenHash: string): Promise<Session | null> {
    const [row] = await this.db.select().from(sessions).where(eq(sessions.tokenHash, tokenHash));
    return row ?? null;
  }

  async deleteByTokenHash(tokenHash: string): Promise<void> {
    await this.db.delete(sessions).where(eq(sessions.tokenHash, tokenHash));
  }

  async deleteExpired(): Promise<void> {
    await this.db.delete(sessions).where(lte(sessions.expiresAt, new Date()));
  }
}
