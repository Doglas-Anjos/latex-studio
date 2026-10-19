import { randomUUID } from 'node:crypto';
import type { LanAccessRow, LanRepository } from '../domain/lan.repository';

export class FakeLan implements LanRepository {
  readonly published = new Set<string>();
  access: LanAccessRow[] = [];

  async publish(projectId: string) {
    this.published.add(projectId);
  }
  async unpublish(projectId: string) {
    this.published.delete(projectId);
  }
  async isPublished(projectId: string) {
    return this.published.has(projectId);
  }
  async listPublished() {
    return [...this.published];
  }
  async createAccess(projectId: string, alias: string, pinHash: string) {
    const id = randomUUID();
    this.access.push({ id, projectId, alias, pinHash, createdAt: new Date(), lastSeen: null });
    return { id };
  }
  async accessesOf(projectId: string) {
    return this.access.filter((a) => a.projectId === projectId);
  }
  async deleteAccess(id: string) {
    this.access = this.access.filter((a) => a.id !== id);
  }
  async touchAccess(id: string) {
    const row = this.access.find((a) => a.id === id);
    if (row) row.lastSeen = new Date();
  }
}
