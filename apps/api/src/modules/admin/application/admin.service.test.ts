import { BadRequestException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it } from 'vitest';
import type { User } from '../../users/domain/user';
import { FakeUsers } from '../../users/testing/fake-user.repository';
import { AdminService } from './admin.service';

describe('AdminService', () => {
  let users: FakeUsers;
  let admin: AdminService;
  let actor: User;
  let ana: User;

  beforeEach(async () => {
    users = new FakeUsers();
    admin = new AdminService(users);
    actor = (await users.create({
      email: 'root@example.com',
      name: 'Root',
      passwordHash: 'x',
      role: 'admin',
      status: 'active',
    })) as User;
    ana = (await users.create({
      email: 'ana@example.com',
      name: 'Ana',
      passwordHash: 'x',
    })) as User;
  });

  it('approves a pending user and filters the list by status', async () => {
    expect(await admin.listUsers('pending')).toEqual([expect.objectContaining({ id: ana.id })]);
    const updated = await admin.updateUser(actor, ana.id, { status: 'active' });
    expect(updated.status).toBe('active');
    expect(await admin.listUsers('pending')).toHaveLength(0);
  });

  it('refuses to let an admin block or demote themselves', async () => {
    await expect(admin.updateUser(actor, actor.id, { status: 'blocked' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(admin.updateUser(actor, actor.id, { role: 'user' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(users.rows.find((u) => u.id === actor.id)).toMatchObject({
      role: 'admin',
      status: 'active',
    });
  });

  it('answers 404 for an unknown id and 400 for an empty patch', async () => {
    await expect(
      admin.updateUser(actor, '00000000-0000-4000-8000-000000000000', { status: 'active' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(admin.updateUser(actor, ana.id, {})).rejects.toBeInstanceOf(BadRequestException);
  });
});
