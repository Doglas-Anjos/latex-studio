import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

export class AnchorDto {
  @IsString()
  @MaxLength(512)
  @Matches(BASE64)
  start!: string;

  @IsString()
  @MaxLength(512)
  @Matches(BASE64)
  end!: string;
}

export class CreateCommentDto {
  // Path shape is enforced by SafePath in the service; this only bounds the input.
  @IsString()
  @MaxLength(1024)
  path!: string;

  @ValidateNested()
  @Type(() => AnchorDto)
  anchor!: AnchorDto;

  @IsString()
  @MaxLength(2000)
  quote!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10_000_000)
  line?: number;

  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  body!: string;
}

export class ReplyDto {
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  body!: string;
}

/** Resolve/reopen, edit the text, or both. */
export class UpdateCommentDto {
  @IsOptional()
  @IsBoolean()
  resolved?: boolean;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  body?: string;
}
