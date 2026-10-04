import type { Project, ProjectRole, ProjectWithRole } from '../domain/project';
import type { NewProject, ProjectPatch, ProjectRepository } from '../domain/project.repository';

export class FakeProjects implements ProjectRepository {
  rows: Project[] = [];
  members: Array<{ projectId: string; userId: string; role: ProjectRole }> = [];
  dirtySince = new Map<string, Date>();
  edits: Array<{ projectId: string; path: string; userId: string }> = [];

  async create(project: NewProject, ownerId: string) {
    const now = new Date();
    const row: Project = {
      mainFile: 'main.tex',
      engine: 'pdflatex',
      createdAt: now,
      updatedAt: now,
      ...project,
      ownerId,
    };
    this.rows.push(row);
    this.members.push({ projectId: row.id, userId: ownerId, role: 'owner' });
    return row;
  }
  async listMembers(projectId: string) {
    return this.members
      .filter((m) => m.projectId === projectId)
      .map((m) => ({ userId: m.userId, name: m.userId, email: m.userId, role: m.role }));
  }
  async setMember(projectId: string, userId: string, role: ProjectRole) {
    const existing = this.members.find((m) => m.projectId === projectId && m.userId === userId);
    if (existing) existing.role = role;
    else this.members.push({ projectId, userId, role });
  }
  async removeMember(projectId: string, userId: string) {
    this.members = this.members.filter((m) => !(m.projectId === projectId && m.userId === userId));
  }
  async findById(id: string) {
    return this.rows.find((p) => p.id === id) ?? null;
  }
  async listForUser(userId: string): Promise<ProjectWithRole[]> {
    return this.members
      .filter((m) => m.userId === userId)
      .flatMap((m) => {
        const p = this.rows.find((r) => r.id === m.projectId);
        return p ? [{ ...p, role: m.role }] : [];
      })
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }
  async roleOf(projectId: string, userId: string) {
    return this.members.find((m) => m.projectId === projectId && m.userId === userId)?.role ?? null;
  }
  async countForUser(userId: string) {
    return this.rows.filter((p) => p.ownerId === userId).length;
  }
  async delete(id: string) {
    this.rows = this.rows.filter((p) => p.id !== id);
    this.members = this.members.filter((m) => m.projectId !== id);
  }
  async update(id: string, patch: ProjectPatch) {
    const row = this.rows.find((p) => p.id === id);
    if (!row) throw new Error('Project not found');
    return Object.assign(row, patch);
  }
  async recordEdit(projectId: string, path: string, userId: string) {
    this.edits.push({ projectId, path, userId });
  }
  async markDirty(id: string) {
    if (!this.dirtySince.has(id)) this.dirtySince.set(id, new Date());
  }
}
