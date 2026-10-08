import { Inject, Injectable } from '@nestjs/common';
import { SPELLER, type Speller } from '../domain/speller';

@Injectable()
export class SpellcheckService {
  constructor(@Inject(SPELLER) private readonly speller: Speller) {}

  async check(lang: string, words: string[]): Promise<{ bad: string[] }> {
    const bad = await this.speller.check(lang, [...new Set(words)]);
    return { bad };
  }

  async suggest(lang: string, word: string): Promise<{ suggestions: string[] }> {
    const suggestions = await this.speller.suggest(lang, word);
    return { suggestions };
  }
}
