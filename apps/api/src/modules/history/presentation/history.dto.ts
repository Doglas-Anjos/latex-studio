import { IsString, Length, MaxLength } from 'class-validator';

export class CommitDto {
  @IsString()
  @Length(1, 200)
  message!: string;
}

export class RestoreDto {
  @IsString()
  @MaxLength(40)
  sha!: string;

  @IsString()
  @MaxLength(1024)
  path!: string;
}
