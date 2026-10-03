import { IsEmail, IsIn } from 'class-validator';
import type { ProjectRole } from '../../projects/domain/project';

const ASSIGNABLE = ['editor', 'reviewer', 'viewer'] as const;

export class InviteDto {
  @IsEmail()
  email!: string;

  @IsIn(ASSIGNABLE)
  role!: ProjectRole;
}

export class SetRoleDto {
  @IsIn(ASSIGNABLE)
  role!: ProjectRole;
}
