import { IsIn, IsOptional } from 'class-validator';
import type { UserRole, UserStatus } from '../../users/domain/user';

const STATUSES = ['pending', 'active', 'blocked'] as const;

export class ListUsersQuery {
  @IsOptional()
  @IsIn(STATUSES)
  status?: UserStatus;
}

export class UpdateUserDto {
  @IsOptional()
  @IsIn(STATUSES)
  status?: UserStatus;

  @IsOptional()
  @IsIn(['admin', 'user'])
  role?: UserRole;
}
