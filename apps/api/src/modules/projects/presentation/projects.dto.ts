import { Transform } from 'class-transformer';
import { IsString } from 'class-validator';
import { INVALID_PROJECT_NAME, parseProjectName } from '../domain/project';

export class CreateProjectDto {
  @Transform(({ value }: { value: unknown }) => parseProjectName(value))
  @IsString({ message: INVALID_PROJECT_NAME })
  name!: string;
}
