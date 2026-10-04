import { describe, expect, it } from 'vitest';
import { detectEngine } from './engine';

describe('detectEngine', () => {
  it('honours the magic comment, then fontspec, else nothing', () => {
    expect(detectEngine('% !TEX program = lualatex\n\\documentclass{article}')).toBe('lualatex');
    expect(detectEngine('%!TeX TS-program = XeLaTeX\n\\usepackage{fontspec}')).toBe('xelatex');
    expect(detectEngine('\\documentclass{memoir}\n\\usepackage[no-math]{fontspec}')).toBe(
      'xelatex',
    );
    expect(detectEngine('\\usepackage{polyglossia}')).toBe('xelatex');
    expect(detectEngine('\\documentclass{article}\n\\usepackage{inputenc}')).toBeNull();
  });
});
