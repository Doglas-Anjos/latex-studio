import { IsEmail, IsIn } from 'class-validator';
import { ASSIGNABLE, type ProjectRole } from '../../projects/domain/project';

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
