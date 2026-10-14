import { describe, expect, it } from 'vitest';
import { parseManifest } from './package-manifest';
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

  it('moves only what the manifest accepts and leaves the rest in the source', () => {
    const kept = [
      '\\usepackage{styles/custom}',
      '\\usepackage{\\mypkg, amsmath}',
      '\\usepackage[a={b]{c}',
      '\\usepackage[font=\\small\\ ]{subcaption}', // trimmed it would end in a lone `\`
      '\\usepackage[draft]{xcolor}', // already in the manifest
    ];
    const src = [
      ...kept,
      '\\usepackage[font=\\small]{caption}',
      '\\usepackage[margin={2cm,3cm}]{geometry}',
      '\\usepackage{hyperref}',
      '\\usepackage[hidelinks]{hyperref}', // a second load keeps its options in the source
    ];
    const { packages, remaining } = extractUsepackages(src.join('\n'), new Set(['xcolor']));
    expect(packages).toEqual([
      { name: 'caption', options: 'font=\\small' },
      { name: 'geometry', options: 'margin={2cm,3cm}' },
      { name: 'hyperref' },
    ]);
    expect(remaining).toBe([...kept, '\\usepackage[hidelinks]{hyperref}'].join('\n'));
    const manifest = packages.map((p, order) => ({ ...p, enabled: true, order }));
    expect(parseManifest(JSON.stringify(manifest))).toEqual(manifest);
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

describe('insertPackagesInput with a multi-line documentclass', () => {
  it('goes after the closing brace, skipping commented brackets inside the options', () => {
    const src = [
      '% header',
      '\\documentclass[',
      '  12pt,  % size',
      '  % \\RequirePackage[brazil]{babel} fixed',
      '  main=english',
      '  ]{abntex2}',
      '\\usepackage{fontspec}',
    ].join('\n');
    const out = insertPackagesInput(src).split('\n');
    expect(out[6]).toBe('\\input{latex-packages}');
    expect(out[5]).toBe('  ]{abntex2}');
    expect(insertPackagesInput(insertPackagesInput(src))).toBe(insertPackagesInput(src));
  });
  it('still handles the one-line form and keeps CRLF', () => {
    expect(insertPackagesInput('\\documentclass{article}\r\nx')).toBe(
      '\\documentclass{article}\r\n\\input{latex-packages}\r\nx',
    );
  });
  it('skips a commented line once, not once per \\documentclass on it', () => {
    const src = `${'%\\documentclass'.repeat(70_000)}\n\\documentclass{article}\nx`;
    const start = performance.now();
    expect(insertPackagesInput(src).split('\n')[2]).toBe('\\input{latex-packages}');
    expect(performance.now() - start).toBeLessThan(300);
  });
});
