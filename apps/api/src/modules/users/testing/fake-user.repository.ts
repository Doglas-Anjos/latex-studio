import { randomUUID } from 'node:crypto';
import type { Identity, User } from '../domain/user';
import type { UserRepository } from '../domain/user.repository';

export class FakeUsers implements UserRepository {
  rows: (User & Identity)[] = [];
  async findByEmail(email: string) {
    return this.rows.find((u) => u.email === email) ?? null;
  }
  async findById(id: string) {
    return this.rows.find((u) => u.id === id) ?? null;
  }
  async upsert(identity: Identity) {
    const row = this.rows.find(
      (u) => u.issuer === identity.issuer && u.subject === identity.subject,
    );
    if (row) return Object.assign(row, { email: identity.email, name: identity.name });
    const created = { id: randomUUID(), createdAt: new Date(), ...identity };
    this.rows.push(created);
    return created;
  }
  async list({ search, limit, offset }: { search?: string; limit: number; offset: number }) {
    const t = search?.toLowerCase();
    const all = this.rows.filter(
      (u) => !t || u.email.toLowerCase().includes(t) || u.name.toLowerCase().includes(t),
    );
    return { items: all.slice(offset, offset + limit), total: all.length };
  }
}
