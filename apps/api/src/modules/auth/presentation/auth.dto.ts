import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsString, Matches, MaxLength, MinLength } from 'class-validator';

const toLowerTrimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

export class RegisterDto {
  @Transform(toLowerTrimmed)
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  @Matches(/^[^\p{C}]+$/u, { message: 'name must not contain control characters' })
  name!: string;

  // Upper bound keeps the argon2 input bounded.
  @IsString()
  @MinLength(12)
  @MaxLength(256)
  password!: string;
}

export class LoginDto {
  @Transform(toLowerTrimmed)
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  password!: string;
}
