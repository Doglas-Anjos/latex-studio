import { ArrayMaxSize, IsArray, IsOptional, IsString, Length, MaxLength } from 'class-validator';

export class CommitDto {
  @IsString()
  @Length(1, 200)
  message!: string;

  /** Only these files (Changes view selection); every change when omitted. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(1000)
  @IsString({ each: true })
  @MaxLength(1024, { each: true })
  paths?: string[];
}

export class CommitFileDto {
  @IsString()
  @MaxLength(1024)
  path!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  message?: string;
}

export class RestoreDto {
  @IsString()
  @MaxLength(40)
  sha!: string;

  @IsString()
  @MaxLength(1024)
  path!: string;
}
