import { DATABASE, type Database } from '@latex-studio/core';
import { users } from '@latex-studio/core/schema';
import { Inject, Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
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
}
