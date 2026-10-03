import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { AuditService } from '../../audit/audit.service';
import type { Project, ProjectRole } from '../../projects/domain/project';
import {
  type Member,
  PROJECT_REPOSITORY,
  type ProjectRepository,
} from '../../projects/domain/project.repository';
import { USER_REPOSITORY, type UserRepository } from '../../users/domain/user.repository';

@Injectable()
export class MembersService {
  constructor(
    @Inject(PROJECT_REPOSITORY) private readonly projects: ProjectRepository,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Optional() @Inject(AuditService) private readonly audit?: AuditService,
  ) {}

  list(project: Project): Promise<Member[]> {
    return this.projects.listMembers(project.id);
  }

  /** Invites by email someone who has opened the app at least once. Only the owner reaches this. */
  async invite(
    project: Project,
    actorId: string,
    email: string,
    role: ProjectRole,
  ): Promise<Member[]> {
    const user = await this.users.findByEmail(email.trim().toLowerCase());
    if (!user) throw new NotFoundException('No user with that email: they must open the app once');
    if (user.id === project.ownerId || role === 'owner') {
      throw new BadRequestException('The owner role cannot be assigned');
    }
    await this.projects.setMember(project.id, user.id, role);
    await this.audit?.record(actorId, 'member.invite', project.id, { userId: user.id, role });
    return this.list(project);
  }

  async setRole(project: Project, userId: string, role: ProjectRole): Promise<Member[]> {
    if (userId === project.ownerId || role === 'owner') {
      throw new BadRequestException('The owner role cannot be changed');
    }
    if (!(await this.projects.listMembers(project.id)).some((m) => m.userId === userId)) {
      throw new NotFoundException('Not a member');
    }
    await this.projects.setMember(project.id, userId, role);
    return this.list(project);
  }

  async remove(project: Project, actorId: string, userId: string): Promise<void> {
    if (userId === project.ownerId) throw new BadRequestException('The owner cannot be removed');
    await this.projects.removeMember(project.id, userId);
    await this.audit?.record(actorId, 'member.remove', project.id, { userId });
  }
}
