import { IsBoolean, IsIn, IsString, Length, Matches, ValidateIf } from 'class-validator';
import { ASSIGNABLE } from '../../projects/domain/project';
import type { LanRole } from '../domain/lan.repository';

export class RemoteDto {
  @IsBoolean()
  on!: boolean;
}

export class CreateAccessDto {
  @IsString()
  @Length(1, 40)
  alias!: string;

  // Optional (editor), but not null: @IsOptional would let null through to a NOT NULL insert.
  @ValidateIf((_, v) => v !== undefined)
  @IsIn(ASSIGNABLE)
  role?: LanRole;
}

export class JoinDto {
  @IsString()
  @Matches(/^\d{4}$/, { message: 'pin must be four digits' })
  pin!: string;
}
