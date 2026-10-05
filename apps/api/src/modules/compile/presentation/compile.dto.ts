import { IsBoolean, IsOptional } from 'class-validator';

export class CompileDto {
  /** Images as frames and no overfull marks (Overleaf's "fast" mode). */
  @IsOptional()
  @IsBoolean()
  draft?: boolean;

  /** false = keep going past errors and still produce a PDF. */
  @IsOptional()
  @IsBoolean()
  haltOnError?: boolean;
}
