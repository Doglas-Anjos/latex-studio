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
  @RequireProjectRole('viewer')
  view() {}
}

const OWNER = '00000000-0000-4000-8000-000000000001';

describe('ProjectRoleGuard', () => {
  let projects: FakeProjects;
  let guard: ProjectRoleGuard;
  let projectId: string;

  beforeEach(async () => {
    projects = new FakeProjects();
    guard = new ProjectRoleGuard(new Reflector(), projects, { SUPERADMIN_EMAILS: '' } as never);
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

  it('lets a superadmin view a project they are not a member of, but not edit it', async () => {
    const adminGuard = new ProjectRoleGuard(new Reflector(), projects, {
      SUPERADMIN_EMAILS: 'admin@x.test',
    } as never);
    const ctx = (handler: () => void) =>
      ({
        switchToHttp: () => ({
          getRequest: () => ({
            params: { projectId },
            user: { id: 'stranger', email: 'admin@x.test' },
          }),
        }),
        getHandler: () => handler,
        getClass: () => Routes,
      }) as unknown as ExecutionContext;
    await expect(adminGuard.canActivate(ctx(Routes.prototype.view))).resolves.toBe(true);
    await expect(adminGuard.canActivate(ctx(Routes.prototype.edit))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
