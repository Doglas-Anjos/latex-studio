import { describe, expect, it } from 'vitest';
import {
  findAcronyms,
  findEquations,
  findFigures,
  findInputs,
  findSections,
  findTables,
} from './document-outline';

describe('findSections', () => {
  it('reads level, title (skipping [short]) and line, and ignores commented ones', () => {
    const src = [
      '\\chapter{Introdução}',
      '\\section[short]{Contexto \\& motivação}',
      '% \\section{Comentada}',
      '\\subsection*{Detalhe}',
    ].join('\n');
    expect(findSections(src)).toEqual([
      { level: 1, title: 'Introdução', line: 1 },
      { level: 2, title: 'Contexto \\& motivação', line: 2 },
      { level: 3, title: 'Detalhe', line: 4 },
    ]);
  });
});

describe('findInputs', () => {
  it('returns \\input/\\include targets in order, skipping comments', () => {
    const src = '\\input{capitulos/cap_01}\n% \\input{old}\n\\include{cap_02}';
    expect(findInputs(src)).toEqual(['capitulos/cap_01', 'cap_02']);
  });
});

describe('findFigures', () => {
  it('extracts caption (with nested braces), label and image path', () => {
    const src = [
      '\\begin{figure}',
      '  \\includegraphics[width=0.5\\textwidth]{img/cap_03/transformer}',
      '  \\caption{Byte-Pair Encoding \\cite{sennrich2015bpe}}',
      '  \\label{fig:bpe}',
      '\\end{figure}',
    ].join('\n');
    expect(findFigures(src)).toEqual([
      {
        caption: 'Byte-Pair Encoding \\cite{sennrich2015bpe}',
        label: 'fig:bpe',
        image: 'img/cap_03/transformer',
        line: 1,
      },
    ]);
  });
});

describe('findTables', () => {
  it('keeps caption, label and the tabular source for preview', () => {
    const src =
      '\\begin{table}\n\\caption{Metrics}\n\\begin{tabular}{cc}\na & b \\\\\n\\end{tabular}\n\\label{tab:m}\n\\end{table}';
    const [t] = findTables(src);
    expect(t?.caption).toBe('Metrics');
    expect(t?.label).toBe('tab:m');
    expect(t?.source).toContain('\\begin{tabular}');
  });
});

describe('findEquations', () => {
  it('strips the label and wraps align in aligned', () => {
    const eq = findEquations('\\begin{equation}\n  x = 1 \\label{eq:a}\n\\end{equation}');
    expect(eq).toEqual([{ label: 'eq:a', source: 'x = 1', line: 1 }]);
    const al = findEquations('\\begin{align}\n  y &= 2\n\\end{align}');
    expect(al[0]?.source).toBe('\\begin{aligned}y &= 2\\end{aligned}');
  });
});

describe('findAcronyms', () => {
  it('parses \\newacronym key/short/long, ignoring comments', () => {
    const src = '\\newacronym{mae}{MAE}{Mean Absolute Error}\n% \\newacronym{x}{X}{hidden}';
    expect(findAcronyms(src)).toEqual([
      { key: 'mae', short: 'MAE', long: 'Mean Absolute Error', line: 1 },
    ]);
  });
});
