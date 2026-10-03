import { DATABASE, type Database } from '@latex-studio/core';
import { users } from '@latex-studio/core/schema';
import { Inject, Injectable } from '@nestjs/common';
import { count, desc, eq } from 'drizzle-orm';
import type { User, UserCredentials, UserRole, UserStatus } from '../domain/user';
import type { NewUser, UserRepository } from '../domain/user.repository';

const publicColumns = {
  id: users.id,
  email: users.email,
  name: users.name,
  role: users.role,
  status: users.status,
  createdAt: users.createdAt,
};

@Injectable()
export class DrizzleUserRepository implements UserRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async findByEmail(email: string): Promise<UserCredentials | null> {
    const [row] = await this.db.select().from(users).where(eq(users.email, email));
    return row ?? null;
  }

  async findById(id: string): Promise<User | null> {
    const [row] = await this.db.select(publicColumns).from(users).where(eq(users.id, id));
    return row ?? null;
  }

  async create(user: NewUser): Promise<User | null> {
    const [row] = await this.db
      .insert(users)
      .values(user)
      .onConflictDoNothing({ target: users.email })
      .returning(publicColumns);
    return row ?? null;
  }

  async countAdmins(): Promise<number> {
    const [row] = await this.db.select({ n: count() }).from(users).where(eq(users.role, 'admin'));
    return row?.n ?? 0;
  }

  async list(status?: UserStatus): Promise<User[]> {
    return this.db
      .select(publicColumns)
      .from(users)
      .where(status ? eq(users.status, status) : undefined)
      .orderBy(desc(users.createdAt));
  }

  async update(id: string, patch: { status?: UserStatus; role?: UserRole }): Promise<User | null> {
    const [row] = await this.db
      .update(users)
      .set(patch)
      .where(eq(users.id, id))
      .returning(publicColumns);
    return row ?? null;
  }
}
