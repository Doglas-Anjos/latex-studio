import { IsOptional, IsString, MaxLength } from 'class-validator';

// Path shape is enforced by SafePath in the service; this only bounds the input.
const MAX_PATH = 1024;

export class CreateFileDto {
  @IsString()
  @MaxLength(MAX_PATH)
  path!: string;

  @IsOptional()
  @IsString()
  content?: string;
}

export class UpdateFileDto {
  @IsString()
  content!: string;
}

export class RenameFileDto {
  @IsString()
  @MaxLength(MAX_PATH)
  from!: string;

  @IsString()
  @MaxLength(MAX_PATH)
  to!: string;
}

export class CreateFolderDto {
  @IsString()
  @MaxLength(MAX_PATH)
  path!: string;
}
