import { DATABASE, type Database } from '@latex-studio/core';
import { users } from '@latex-studio/core/schema';
import { Inject, Injectable } from '@nestjs/common';
import { count, desc, eq, ilike, or, sql } from 'drizzle-orm';
import type { Identity, User } from '../domain/user';
import type { UserRepository } from '../domain/user.repository';

const publicColumns = {
  id: users.id,
  email: users.email,
  name: users.name,
  createdAt: users.createdAt,
};

@Injectable()
export class DrizzleUserRepository implements UserRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async findByEmail(email: string): Promise<User | null> {
    const [row] = await this.db.select(publicColumns).from(users).where(eq(users.email, email));
    return row ?? null;
  }

  async findById(id: string): Promise<User | null> {
    const [row] = await this.db.select(publicColumns).from(users).where(eq(users.id, id));
    return row ?? null;
  }

  // ponytail: an email that collides with another account surfaces as a unique violation (500);
  // merge accounts by hand if the issuer ever reassigns subjects.
  async upsert(identity: Identity): Promise<User> {
    const [row] = await this.db
      .insert(users)
      .values(identity)
      .onConflictDoUpdate({
        target: [users.issuer, users.subject],
        set: { email: sql`excluded.email`, name: sql`excluded.name` },
      })
      .returning(publicColumns);
    return row as User;
  }

  async list({ search, limit, offset }: { search?: string; limit: number; offset: number }) {
    // Escape LIKE wildcards in the admin's search text (Postgres LIKE escape is backslash).
    const term = search?.trim().replace(/[%_]/g, '$&');
    const where = term
      ? or(ilike(users.email, `%${term}%`), ilike(users.name, `%${term}%`))
      : undefined;
    const items = await this.db
      .select(publicColumns)
      .from(users)
      .where(where)
      .orderBy(desc(users.createdAt))
      .limit(limit)
      .offset(offset);
    const [row] = await this.db.select({ total: count() }).from(users).where(where);
    return { items, total: Number(row?.total ?? 0) };
  }
}
