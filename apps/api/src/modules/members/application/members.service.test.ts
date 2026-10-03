import { BadRequestException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Project } from '../../projects/domain/project';
import { FakeProjects } from '../../projects/testing/fake-project.repository';
import { FakeUsers } from '../../users/testing/fake-user.repository';
import { MembersService } from './members.service';

describe('MembersService', () => {
  let projects: FakeProjects;
  let users: FakeUsers;
  let service: MembersService;
  let project: Project;
  let anaId: string;

  beforeEach(async () => {
    projects = new FakeProjects();
    users = new FakeUsers();
    service = new MembersService(projects, users);
    project = await projects.create({ id: 'p1', name: 'P' }, 'owner-1');
    const ana = await users.create({ email: 'ana@example.com', name: 'Ana', passwordHash: 'h' });
    if (!ana) throw new Error('fake create failed');
    anaId = ana.id;
    await users.update(anaId, { status: 'active' });
  });

  it('invites an active user by email and lists the membership', async () => {
    const members = await service.invite(project, 'Ana@Example.com', 'reviewer');
    expect(members.map((m) => m.role).sort()).toEqual(['owner', 'reviewer']);
    expect(await projects.roleOf('p1', anaId)).toBe('reviewer');
  });

  it('rejects unknown emails and the owner role', async () => {
    await expect(service.invite(project, 'nobody@example.com', 'editor')).rejects.toThrow(
      NotFoundException,
    );
    await expect(service.invite(project, 'ana@example.com', 'owner')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('changes a role and removes a member, never the owner', async () => {
    await service.invite(project, 'ana@example.com', 'viewer');
    await service.setRole(project, anaId, 'editor');
    expect(await projects.roleOf('p1', anaId)).toBe('editor');
    await service.remove(project, anaId);
    expect(await projects.roleOf('p1', anaId)).toBeNull();
    await expect(service.remove(project, 'owner-1')).rejects.toThrow(BadRequestException);
  });
});
