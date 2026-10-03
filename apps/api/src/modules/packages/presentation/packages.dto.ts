import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class PackageEntryDto {
  @Matches(/^[A-Za-z0-9._-]+$/)
  @MaxLength(100)
  name!: string;

  // No braces, brackets or line breaks: the options are written verbatim into \usepackage[...]{...}.
  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Matches(/^[^{}[\]\r\n]*$/)
  options?: string;

  @IsBoolean()
  enabled!: boolean;

  @IsInt()
  order!: number;
}

export class SetPackagesDto {
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => PackageEntryDto)
  packages!: PackageEntryDto[];
}
