import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { INVALID_PROJECT_NAME, type ProjectEngine, parseProjectName } from '../domain/project';

export class CreateProjectDto {
  @Transform(({ value }: { value: unknown }) => parseProjectName(value))
  @IsString({ message: INVALID_PROJECT_NAME })
  name!: string;
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
