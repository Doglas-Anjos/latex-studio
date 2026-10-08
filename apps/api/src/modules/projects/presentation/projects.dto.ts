import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { INVALID_PROJECT_NAME, type ProjectEngine, parseProjectName } from '../domain/project';
import type { ProjectListFilter } from '../domain/project.repository';

export class CreateProjectDto {
  @Transform(({ value }: { value: unknown }) => parseProjectName(value))
  @IsString({ message: INVALID_PROJECT_NAME })
  name!: string;
}

export class ListProjectsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;

  @IsOptional()
  @IsIn(['all', 'mine', 'shared'])
  filter?: ProjectListFilter;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  cursor?: string;
}

export class UpdateProjectDto {
  @IsOptional()
  @IsIn(['pdflatex', 'xelatex', 'lualatex'])
  engine?: ProjectEngine;

  @IsOptional()
  @IsString()
  @MaxLength(1024)
  mainFile?: string;
}
