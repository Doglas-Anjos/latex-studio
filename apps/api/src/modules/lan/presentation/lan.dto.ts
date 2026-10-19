import { IsBoolean, IsString, Length, Matches } from 'class-validator';

export class RemoteDto {
  @IsBoolean()
  on!: boolean;
}

export class CreateAccessDto {
  @IsString()
  @Length(1, 40)
  alias!: string;
}

export class JoinDto {
  @IsString()
  @Matches(/^\d{4}$/, { message: 'pin must be four digits' })
  pin!: string;
}
