import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ProjectsService } from '../../projects/application/projects.service';
import {
  PROJECT_REPOSITORY,
  type ProjectListPage,
  type ProjectRepository,
} from '../../projects/domain/project.repository';
import type { User } from '../../users/domain/user';
import { USER_REPOSITORY, type UserRepository } from '../../users/domain/user.repository';

/** Governance queries for a platform superadmin; every caller is already behind AdminGuard. */
@Injectable()
export class AdminService {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(PROJECT_REPOSITORY) private readonly projects: ProjectRepository,
    @Inject(ProjectsService) private readonly projectsService: ProjectsService,
  ) {}

  listUsers(opts: { search?: string; limit?: number; page?: number }) {
    const limit = opts.limit ?? 25;
    const page = opts.page ?? 0;
    return this.users.list({
      limit,
      offset: page * limit,
      ...(opts.search ? { search: opts.search } : {}),
    });
  }

  async userProjects(userId: string, limit: number): Promise<ProjectListPage> {
    const target = await this.users.findById(userId);
    if (!target) throw new NotFoundException('User not found');
    // Reuses the normal listing for an arbitrary user: every project they belong to.
    return this.projects.listPageForUser(userId, {
      limit,
      filter: 'all',
      search: '',
      cursor: null,
    });
  }

  async deleteProject(projectId: string, actor: User): Promise<void> {
    const project = await this.projects.findById(projectId);
    if (!project) throw new NotFoundException('Project not found');
    await this.projectsService.forceRemove(project, actor);
  }
}
