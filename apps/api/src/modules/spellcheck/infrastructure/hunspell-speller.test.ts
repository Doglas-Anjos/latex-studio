import { expect, it } from 'vitest';
import { HunspellSpeller } from './hunspell-speller';

// Real Hunspell dictionaries load in Node; the first wasm + dict load needs a generous timeout.
const speller = new HunspellSpeller();

it('flags only the misspelled English words', async () => {
  const bad = await speller.check('en-US', ['house', 'running', 'teh', 'wrongg']);
  expect(bad.sort()).toEqual(['teh', 'wrongg']);
}, 20000);

it('flags Portuguese misspellings and accepts inflected forms', async () => {
  const bad = await speller.check('pt-BR', ['casa', 'corríamos', 'dissertação', 'erradaa']);
  expect(bad).toEqual(['erradaa']);
}, 20000);

it('suggests a correction', async () => {
  const suggestions = await speller.suggest('pt-BR', 'verificacao');
  expect(suggestions).toContain('verificação');
}, 20000);

it('returns nothing for an unsupported language', async () => {
  expect(await speller.check('ja', ['foo'])).toEqual([]);
  expect(await speller.suggest('ja', 'foo')).toEqual([]);
});
