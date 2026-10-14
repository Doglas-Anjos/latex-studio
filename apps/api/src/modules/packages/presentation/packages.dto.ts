import { PACKAGE_NAME, PACKAGE_OPTIONS } from '@latex-studio/latex-tools';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  ValidateNested,
} from 'class-validator';

// The manifest's own rules; parseManifest (run by the service) also requires balanced braces.
export class PackageEntryDto {
  @Matches(PACKAGE_NAME)
  name!: string;

  @IsOptional()
  @IsString()
  @Matches(PACKAGE_OPTIONS)
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
