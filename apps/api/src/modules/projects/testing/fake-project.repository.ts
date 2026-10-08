import type { Project, ProjectRole } from '../domain/project';
import type {
  NewProject,
  ProjectListOptions,
  ProjectListPage,
  ProjectPatch,
  ProjectRepository,
} from '../domain/project.repository';

export class FakeProjects implements ProjectRepository {
  rows: Project[] = [];
  members: Array<{ projectId: string; userId: string; role: ProjectRole }> = [];
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
  async listPageForUser(userId: string, options: ProjectListOptions): Promise<ProjectListPage> {
    const matches = this.members
      .filter((m) => m.userId === userId)
      .flatMap((m) => {
        const p = this.rows.find((r) => r.id === m.projectId);
        return p ? [{ ...p, role: m.role }] : [];
      })
      .filter((p) =>
        options.filter === 'all' ? true : (p.role === 'owner') === (options.filter === 'mine'),
      )
      .filter((p) =>
        p.name
          .normalize('NFD')
          .replace(/\p{Diacritic}/gu, '')
          .toLowerCase()
          .includes(options.search),
      )
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime() || (a.id < b.id ? 1 : -1));
    const after = options.cursor;
    const remaining = after
      ? matches.filter(
          (p) =>
            p.updatedAt.toISOString() < after.updatedAt ||
            (p.updatedAt.toISOString() === after.updatedAt && p.id < after.id),
        )
      : matches;
    const items = remaining.slice(0, options.limit);
    const last = items.at(-1);
    return {
      items,
      total: matches.length,
      next:
        remaining.length > options.limit && last
          ? { updatedAt: last.updatedAt.toISOString(), id: last.id }
          : null,
    };
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
  /** Users are named by their id, as in `listMembers`. */
  async withEditors<T>(
    projectId: string,
    paths: string[] | null,
    commit: (editors: Array<{ name: string; email: string }>) => Promise<T>,
  ) {
    const read = this.edits.filter(
      (e) => e.projectId === projectId && (!paths || paths.includes(e.path)),
    );
    const result = await commit(
      [...new Set(read.map((e) => e.userId))].map((id) => ({ name: id, email: id })),
    );
    this.edits = this.edits.filter((e) => !read.includes(e));
    return result;
  }
}
