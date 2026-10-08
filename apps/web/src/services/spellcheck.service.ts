import { createToken } from '../di/container';
import type { ApiClient } from './api-client';

/** Checks document words against a language dictionary on the server (Hunspell runs there). */
export interface SpellcheckService {
  /** The subset of `words` the `lang` dictionary does not know. */
  check(projectId: string, lang: string, words: string[]): Promise<string[]>;
  /** Spelling suggestions for one word. */
  suggest(projectId: string, lang: string, word: string): Promise<string[]>;
}

export const SpellcheckServiceToken = createToken<SpellcheckService>('SpellcheckService');

export class HttpSpellcheckService implements SpellcheckService {
  constructor(private readonly api: ApiClient) {}

  async check(projectId: string, lang: string, words: string[]): Promise<string[]> {
    const { bad } = await this.api.post<{ bad: string[] }>(`/projects/${projectId}/spellcheck`, {
      lang,
      words,
    });
    return bad;
  }

  async suggest(projectId: string, lang: string, word: string): Promise<string[]> {
    const { suggestions } = await this.api.post<{ suggestions: string[] }>(
      `/projects/${projectId}/spellcheck/suggest`,
      { lang, word },
    );
    return suggestions;
  }
}
