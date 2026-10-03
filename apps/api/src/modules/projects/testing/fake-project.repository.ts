import type { Project, ProjectRole, ProjectWithRole } from '../domain/project';
import type { NewProject, ProjectRepository } from '../domain/project.repository';

export class FakeProjects implements ProjectRepository {
  rows: Project[] = [];
  members: Array<{ projectId: string; userId: string; role: ProjectRole }> = [];

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
}
