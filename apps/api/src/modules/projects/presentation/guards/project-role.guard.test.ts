import { randomUUID } from 'node:crypto';
import { type ExecutionContext, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';
import type { User } from '../../../users/domain/user';
import { FakeProjects } from '../../testing/fake-project.repository';
import { ProjectRoleGuard, RequireProjectRole } from './project-role.guard';

class Routes {
  @RequireProjectRole('editor')
  edit() {}
}

const OWNER = '00000000-0000-4000-8000-000000000001';

describe('ProjectRoleGuard', () => {
  let projects: FakeProjects;
  let guard: ProjectRoleGuard;
  let projectId: string;

  beforeEach(async () => {
    projects = new FakeProjects();
    guard = new ProjectRoleGuard(new Reflector(), projects);
    projectId = (await projects.create({ id: randomUUID(), name: 'P' }, OWNER)).id;
  });

  const run = (userId: string) => {
    const request = { params: { projectId }, user: { id: userId } as User } as FastifyRequest;
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => Routes.prototype.edit,
      getClass: () => Routes,
    } as unknown as ExecutionContext;
    return { request, result: guard.canActivate(context) };
  };

  const member = (role: 'viewer' | 'editor') => {
    const userId = randomUUID();
    projects.members.push({ projectId, userId, role });
    return userId;
  };

  it('answers 404 to a non-member', async () => {
    await expect(run(randomUUID()).result).rejects.toBeInstanceOf(NotFoundException);
  });

  it('answers 403 to a viewer on an editor route', async () => {
    await expect(run(member('viewer')).result).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('lets an editor through and attaches the project and role', async () => {
    const { request, result } = run(member('editor'));
    await expect(result).resolves.toBe(true);
    expect(request.project?.id).toBe(projectId);
    expect(request.projectRole).toBe('editor');
  });
});
