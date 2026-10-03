import { expect, it } from 'vitest';
import { approxWords } from './word-count';

it('counts words, ignoring comments and commands', () => {
  expect(
    approxWords('\\section{Olá mundo} texto % comentário aqui\nmais \\textbf{dois} 100\\% ok'),
  ).toBe(6);
  expect(approxWords('')).toBe(0);
});
