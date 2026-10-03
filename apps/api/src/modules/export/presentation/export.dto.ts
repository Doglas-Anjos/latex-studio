import { IsString, MaxLength } from 'class-validator';

export class FormatDto {
  @IsString()
  @MaxLength(1024)
  path!: string;
}
