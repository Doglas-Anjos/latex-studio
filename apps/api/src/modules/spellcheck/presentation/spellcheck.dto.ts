import { ArrayMaxSize, IsArray, IsIn, IsString, Length } from 'class-validator';

// Languages we have a dictionary for; anything else is rejected rather than silently unchecked.
export const SPELL_LANGS = ['pt-BR', 'en-US'] as const;

export class SpellcheckDto {
  @IsIn(SPELL_LANGS)
  lang!: string;

  @IsArray()
  @ArrayMaxSize(5000)
  @IsString({ each: true })
  @Length(1, 100, { each: true })
  words!: string[];
}

export class SuggestDto {
  @IsIn(SPELL_LANGS)
  lang!: string;

  // Hunspell suggest() runs on the event loop; keep the input short so it stays cheap.
  @IsString()
  @Length(1, 40)
  word!: string;
}
