import { IsString, Matches, MaxLength } from 'class-validator';

export class FormatDto {
  @IsString()
  @MaxLength(1024)
  @Matches(/\.(tex|sty|cls|bib)$/i)
  path!: string;

  /** The live editor text: formatting the disk snapshot would revert the last seconds of typing. */
  @IsString()
  @MaxLength(1024 * 1024)
  text!: string;
}
