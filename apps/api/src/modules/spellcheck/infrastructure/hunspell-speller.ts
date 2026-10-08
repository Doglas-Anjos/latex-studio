import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Injectable } from '@nestjs/common';
import { type Hunspell, type HunspellFactory, loadModule } from 'hunspell-asm';
import type { Speller } from '../domain/speller';

// Hunspell dictionaries, keyed by the language family we support. Their `exports` field hides the
// .aff/.dic, so we read them from the package directory directly.
const PACKAGE: Record<string, string> = { en: 'dictionary-en', pt: 'dictionary-pt' };
const dictKey = (lang: string): string | undefined =>
  lang.startsWith('pt') ? 'pt' : lang.startsWith('en') ? 'en' : undefined;

/**
 * Spell checker backed by Hunspell compiled to WebAssembly. Runs here (Node) rather than the
 * browser because the full Brazilian dictionary overflows the browser engine's limits, and because
 * hunspell-asm's wasm glue only loads cleanly under CommonJS.
 */
@Injectable()
export class HunspellSpeller implements Speller {
  private factory: Promise<HunspellFactory> | undefined;
  // ponytail: one Hunspell per language kept for the process life (dict load ~360ms, tens of MB of
  // wasm heap). Fine for two languages; add an LRU/dispose if that grows.
  private readonly instances = new Map<string, Promise<Hunspell>>();

  async check(lang: string, words: string[]): Promise<string[]> {
    const key = dictKey(lang);
    if (!key) return [];
    const hs = await this.load(key);
    return words.filter((w) => !hs.spell(w));
  }

  async suggest(lang: string, word: string): Promise<string[]> {
    const key = dictKey(lang);
    if (!key) return [];
    const hs = await this.load(key);
    return hs.suggest(word);
  }

  private load(key: string): Promise<Hunspell> {
    let inst = this.instances.get(key);
    if (!inst) {
      inst = this.create(key);
      // A transient failure (missing file, wasm init) must not cache a rejected promise forever.
      inst.catch(() => this.instances.delete(key));
      this.instances.set(key, inst);
    }
    return inst;
  }

  private async create(key: string): Promise<Hunspell> {
    if (!this.factory) {
      this.factory = loadModule();
      this.factory.catch(() => {
        this.factory = undefined;
      });
    }
    const factory = await this.factory;
    const dir = dirname(require.resolve(PACKAGE[key] as string));
    const [aff, dic] = await Promise.all([
      readFile(join(dir, 'index.aff')),
      readFile(join(dir, 'index.dic')),
    ]);
    return factory.create(
      factory.mountBuffer(new Uint8Array(aff)),
      factory.mountBuffer(new Uint8Array(dic)),
    );
  }
}
