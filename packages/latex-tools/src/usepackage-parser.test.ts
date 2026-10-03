import { describe, expect, it } from 'vitest';
import { extractUsepackages, findUsepackages, insertPackagesInput } from './usepackage-parser';

const source = [
  '\\documentclass{article}',
  '\\usepackage[utf8]{inputenc}',
  '\\usepackage{amsmath, amssymb}',
  '% \\usepackage{tikz}',
  '\\title{100\\% done}',
  '\\begin{document}',
  '\\usepackage{late}',
  '\\end{document}',
].join('\n');

describe('extractUsepackages', () => {
  it('extracts preamble packages only and strips their lines', () => {
    const { packages, remaining } = extractUsepackages(source);
    expect(packages).toEqual([
      { name: 'inputenc', options: 'utf8' },
      { name: 'amsmath' },
      { name: 'amssymb' },
    ]);
    expect(remaining).toBe(
      [
        '\\documentclass{article}',
        '% \\usepackage{tikz}',
        '\\title{100\\% done}',
        '\\begin{document}',
        '\\usepackage{late}',
        '\\end{document}',
      ].join('\n'),
    );
  });

  it('handles RequirePackage and spaces', () => {
    const { packages } = extractUsepackages('\\RequirePackage [a=b] { x }\n');
    expect(packages).toEqual([{ name: 'x', options: 'a=b' }]);
  });
});

describe('insertPackagesInput', () => {
  it('inserts after documentclass and is idempotent', () => {
    const once = insertPackagesInput(source);
    expect(once.split('\n').slice(0, 2)).toEqual([
      '\\documentclass{article}',
      '\\input{latex-packages}',
    ]);
    expect(insertPackagesInput(once)).toBe(once);
  });
});

describe('findUsepackages', () => {
  it('lists packages with line and options, ignoring comments, beyond the preamble', () => {
    const src =
      '\\usepackage[a]{x, y}\n% \\usepackage{z}\n\\begin{document}\n\\RequirePackage{w} % \\usepackage{v}\n';
    expect(findUsepackages(src)).toEqual([
      { name: 'x', options: 'a', line: 1 },
      { name: 'y', options: 'a', line: 1 },
      { name: 'w', line: 4 },
    ]);
  });
});
