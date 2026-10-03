import { randomUUID } from 'node:crypto';
import type { User, UserCredentials, UserRole, UserStatus } from '../domain/user';
import type { NewUser, UserRepository } from '../domain/user.repository';

export class FakeUsers implements UserRepository {
  rows: UserCredentials[] = [];
  async findByEmail(email: string) {
    return this.rows.find((u) => u.email === email) ?? null;
  }
  async findById(id: string) {
    return this.rows.find((u) => u.id === id) ?? null;
  }
  async create(user: NewUser) {
    if (this.rows.some((u) => u.email === user.email)) return null;
    const row: UserCredentials = {
      id: randomUUID(),
      role: 'user',
      status: 'pending',
      createdAt: new Date(),
      ...user,
    };
    this.rows.push(row);
    return row;
  }
  async countAdmins() {
    return this.rows.filter((u) => u.role === 'admin').length;
  }
  async list(status?: UserStatus): Promise<User[]> {
    return this.rows
      .filter((u) => !status || u.status === status)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }
  async update(id: string, patch: { status?: UserStatus; role?: UserRole }) {
    const row = this.rows.find((u) => u.id === id);
    return row ? Object.assign(row, patch) : null;
  }
}
