import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { AuditService } from '../../audit/audit.service';
import type { User, UserRole, UserStatus } from '../../users/domain/user';
import { USER_REPOSITORY, type UserRepository } from '../../users/domain/user.repository';

@Injectable()
export class AdminService {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Optional() @Inject(AuditService) private readonly audit?: AuditService,
  ) {}

  listUsers(status?: UserStatus): Promise<User[]> {
    return this.users.list(status);
  }

  async updateUser(
    actor: User,
    id: string,
    patch: { status?: UserStatus; role?: UserRole },
  ): Promise<User> {
    if (patch.status === undefined && patch.role === undefined) {
      throw new BadRequestException('Provide status or role');
    }
    if (
      actor.id === id &&
      ((patch.status ?? 'active') !== 'active' || (patch.role ?? 'admin') !== 'admin')
    ) {
      throw new BadRequestException('You cannot demote or block yourself');
    }
    const user = await this.users.update(id, patch);
    if (!user) throw new NotFoundException('User not found');
    await this.audit?.record(actor.id, 'user.update', id, patch);
    return user;
  }
}
