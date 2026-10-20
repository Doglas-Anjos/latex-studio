import { randomUUID } from 'node:crypto';
import type { LanAccessRow, LanRepository, LanRole } from '../domain/lan.repository';

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
  async createAccess(
    projectId: string,
    userId: string,
    alias: string,
    pinHash: string,
    role: LanRole = 'editor',
  ) {
    const id = randomUUID();
    this.access.push({
      id,
      projectId,
      userId,
      alias,
      role,
      pinHash,
      createdAt: new Date(),
      lastSeen: null,
    });
    return { id };
  }
  async accessesOf(projectId: string) {
    return this.access.filter((a) => a.projectId === projectId);
  }
  async accessRole(projectId: string, userId: string) {
    return this.access.find((a) => a.projectId === projectId && a.userId === userId)?.role ?? null;
  }
  async deleteAccess(projectId: string, id: string) {
    this.access = this.access.filter((a) => !(a.projectId === projectId && a.id === id));
  }
  async touchAccess(id: string) {
    const row = this.access.find((a) => a.id === id);
    if (row) row.lastSeen = new Date();
  }
}
