export const SPELLER = Symbol('SPELLER');

/** Checks words against a language's dictionary. Implemented by a Hunspell (wasm) adapter. */
export interface Speller {
  /** The subset of `words` not in the `lang` dictionary; empty if the language is unsupported. */
  check(lang: string, words: string[]): Promise<string[]>;
  /** Spelling suggestions for one word; empty if none or the language is unsupported. */
  suggest(lang: string, word: string): Promise<string[]>;
}
