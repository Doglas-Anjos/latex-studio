import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import {
  type ExecutionContext,
  ForbiddenException,
  NotFoundException,
  RequestMethod,
} from '@nestjs/common';
import { METHOD_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';
import { CommentsController } from '../../../comments/presentation/comments.controller';
import { CompileController } from '../../../compile/presentation/compile.controller';
import { ExportController } from '../../../export/presentation/export.controller';
import { FilesController } from '../../../files/presentation/files.controller';
import { HistoryController } from '../../../history/presentation/history.controller';
import { LanService } from '../../../lan/application/lan.service';
import { LanTokenService } from '../../../lan/application/lan-token.service';
import { LanController } from '../../../lan/presentation/lan.controller';
import { FakeLan } from '../../../lan/testing/fake-lan.repository';
import { MembersController } from '../../../members/presentation/members.controller';
import { PackagesController } from '../../../packages/presentation/packages.controller';
import { SpellcheckController } from '../../../spellcheck/presentation/spellcheck.controller';
import type { User } from '../../../users/domain/user';
import { FakeUsers } from '../../../users/testing/fake-user.repository';
import { FakeProjects } from '../../testing/fake-project.repository';
import { ProjectsController } from '../projects.controller';
import { ProjectRoleGuard, RequireProjectRole } from './project-role.guard';

it('pins the role every non-GET project route requires (viewers write nothing)', () => {
  const actual: Record<string, string> = {};
  for (const C of [
    FilesController,
    PackagesController,
    HistoryController,
    ProjectsController,
    CompileController,
    ExportController,
    CommentsController,
    MembersController,
    LanController,
    SpellcheckController,
  ]) {
    for (const name of Object.getOwnPropertyNames(C.prototype)) {
      const handler = (C.prototype as unknown as Record<string, object>)[name] as object;
      const method = Reflect.getMetadata(METHOD_METADATA, handler);
      if (method === undefined || method === RequestMethod.GET) continue;
      const key = Reflect.getMetadataKeys(handler).find(
        (k) => String(k) === 'Symbol(PROJECT_ROLE)',
      );
      actual[`${C.name}.${name}`] = key ? Reflect.getMetadata(key, handler) : 'none';
    }
  }
  const editor = (c: string, ...names: string[]) => names.map((n) => [`${c}.${n}`, 'editor']);
  expect(actual).toEqual({
    ...Object.fromEntries([
      ...editor(
        'FilesController',
        'create',
        'rename',
        'update',
        'remove',
        'createFolder',
        'upload',
      ),
      ...editor('PackagesController', 'set', 'migrate'),
      ...editor('HistoryController', 'commit', 'commitFile', 'restore'),
      ...editor('ProjectsController', 'update'),
      ...editor('CompileController', 'request', 'cancel'),
      ...editor('ExportController', 'copy', 'wordCount', 'requestExport', 'format'),
    ]),
    // Not project-scoped (the project does not exist yet) or public (PIN join).
    'ProjectsController.create': 'none',
    'ProjectsController.import': 'none',
    'LanController.join': 'none',
    'ProjectsController.remove': 'owner',
    'MembersController.invite': 'owner',
    'MembersController.setRole': 'owner',
    'MembersController.remove': 'owner',
    'LanController.publish': 'owner',
    'LanController.unpublish': 'owner',
    'LanController.createAccess': 'owner',
    'LanController.revoke': 'owner',
    'CommentsController.create': 'reviewer',
    'CommentsController.update': 'reviewer',
    'CommentsController.remove': 'reviewer',
    'CommentsController.reply': 'reviewer',
    'CommentsController.removeReply': 'reviewer',
    // POST only to carry the words; reads nothing but the dictionary.
    'SpellcheckController.check': 'viewer',
    'SpellcheckController.suggest': 'viewer',
  });
});

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

  it('gives a LAN guest their access role only while the project stays published', async () => {
    const tokens = new LanTokenService({ LAN_SHARE: true, LAN_SECRET: 'x'.repeat(32) });
    tokens.setRemote(true);
    const repo = new FakeLan();
    const lan = new LanService(repo, new FakeUsers(), tokens);
    guard = new ProjectRoleGuard(
      new Reflector(),
      projects,
      { SUPERADMIN_EMAILS: '' } as never,
      lan,
    );
    await lan.publish(projectId);
    await lan.createAccess(projectId, 'Gus');
    const guestId = repo.access[0]?.userId ?? '';
    const { request, result } = run(guestId);
    await expect(result).resolves.toBe(true);
    expect(request.projectRole).toBe('editor');
    expect(request.viaAdmin).toBe(false);
    // A viewer access writes nothing, nor does a guest made a viewer member (membership wins).
    await lan.createAccess(projectId, 'Leo', 'viewer');
    await expect(run(repo.access[1]?.userId ?? '').result).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    projects.members.push({ projectId, userId: guestId, role: 'viewer' });
    await expect(run(guestId).result).rejects.toBeInstanceOf(ForbiddenException);
    projects.members.pop();
    await lan.unpublish(projectId);
    await expect(run(guestId).result).rejects.toBeInstanceOf(NotFoundException);
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
