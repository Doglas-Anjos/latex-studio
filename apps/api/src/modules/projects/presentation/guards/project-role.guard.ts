import {
  applyDecorators,
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  SetMetadata,
  UseGuards,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { isUUID } from 'class-validator';
import type { FastifyRequest } from 'fastify';
import { type Project, type ProjectRole, ROLE_RANK } from '../../domain/project';
import { PROJECT_REPOSITORY, type ProjectRepository } from '../../domain/project.repository';

declare module 'fastify' {
  interface FastifyRequest {
    project?: Project;
    projectRole?: ProjectRole;
  }
}

const PROJECT_ROLE = Symbol('PROJECT_ROLE');

/**
 * 404 unless the user is a member of `:projectId`, 403 below `role`; sets `request.project` and
 * `request.projectRole`. Runs after the global SessionGuard.
 */
@Injectable()
export class ProjectRoleGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(PROJECT_REPOSITORY) private readonly projects: ProjectRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Fail closed if the guard is ever applied without @RequireProjectRole.
    const required =
      this.reflector.getAllAndOverride<ProjectRole | undefined>(PROJECT_ROLE, [
        context.getHandler(),
        context.getClass(),
      ]) ?? 'owner';
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const { projectId } = request.params as { projectId?: string };
    const userId = request.user?.id;

    // Guards run before pipes, so the id is validated here. Non-members get the same 404 as a
    // missing project, so project ids cannot be probed.
    const role =
      projectId && isUUID(projectId) && userId
        ? await this.projects.roleOf(projectId, userId)
        : null;
    const project = role && projectId ? await this.projects.findById(projectId) : null;
    if (!role || !project) throw new NotFoundException('Project not found');
    if (ROLE_RANK[role] < ROLE_RANK[required]) {
      throw new ForbiddenException(`Requires the ${required} role`);
    }
    request.project = project;
    request.projectRole = role;
    return true;
  }
}

export const RequireProjectRole = (role: ProjectRole) =>
  applyDecorators(SetMetadata(PROJECT_ROLE, role), UseGuards(ProjectRoleGuard));

export const CurrentProject = createParamDecorator(
  (_: unknown, context: ExecutionContext): Project => {
    const project = context.switchToHttp().getRequest<FastifyRequest>().project;
    if (!project) throw new Error('@CurrentProject() requires @RequireProjectRole()');
    return project;
  },
);
