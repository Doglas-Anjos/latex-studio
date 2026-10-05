import { expect, it } from 'vitest';
import { parseLatexLog } from './log-parser';

it('reads TeX Live 2026 "ignored:" recoveries as warnings in the current file', () => {
  const log = [
    '(./main.tex',
    'ignored: Infinite glue shrinkage found in box being split [2] [3] [4] (out/main.aux)',
    ')',
  ].join('\n');
  const { errors, warnings } = parseLatexLog(log);
  expect(errors).toEqual([]);
  expect(warnings).toEqual([
    { file: './main.tex', message: 'Infinite glue shrinkage found in box being split' },
  ]);
});

const log = `This is pdfTeX, Version 3.141592653-2.6-1.40.25
(./main.tex
LaTeX2e <2023-11-01>
(/usr/share/texlive/texmf-dist/tex/latex/base/article.cls)
(./chapters/intro.tex
Overfull \\hbox (12.0pt too wide) in paragraph at lines 3--4
! Undefined control sequence.
l.12 \\foo
           bar
?
LaTeX Warning: Reference \`fig:a' on page 1 undefined on input line 30.

Package hyperref Warning: Token not allowed in a PDF string (PDFDocEncoding):
(hyperref)                removing \`math shift' on input line 41.

)
! LaTeX Error: File \`foo.sty' not found.

Type X to quit.
)`;

it('parses errors and warnings with file and line', () => {
  const { errors, warnings, info } = parseLatexLog(log);
  expect(info).toEqual([
    { file: './chapters/intro.tex', line: 3, message: 'Overfull \\hbox (12.0pt too wide)' },
  ]);
  expect(errors).toEqual([
    { file: './chapters/intro.tex', line: 12, message: 'Undefined control sequence.' },
    { file: './main.tex', message: "LaTeX Error: File `foo.sty' not found." },
  ]);
  expect(warnings).toEqual([
    { file: './chapters/intro.tex', line: 30, message: "Reference `fig:a' on page 1 undefined" },
    {
      file: './chapters/intro.tex',
      line: 41,
      message: "Token not allowed in a PDF string (PDFDocEncoding): removing `math shift'",
    },
  ]);
});

it('parses -file-line-error style errors', () => {
  const log = [
    't.tex:3: Undefined control sequence.',
    String.raw`l.3 \undefinedmacro`,
    't.tex:3:  ==> Fatal error occurred, no output PDF file produced!',
  ].join('\n');
  expect(parseLatexLog(log).errors).toEqual([
    { file: 't.tex', line: 3, message: 'Undefined control sequence.' },
  ]);
});

it('treats a file:line error TeX recovered from (no l.<n> context) as a warning', () => {
  const log = [
    './cap.tex:225: Infinite glue shrinkage found in box being split',
    '[30]',
    './cap.tex:9: Undefined control sequence.',
    String.raw`l.9 \foo`,
  ].join('\n');
  const { errors, warnings } = parseLatexLog(log);
  expect(errors).toEqual([{ file: './cap.tex', line: 9, message: 'Undefined control sequence.' }]);
  expect(warnings).toEqual([
    { file: './cap.tex', line: 225, message: 'Infinite glue shrinkage found in box being split' },
  ]);
});

it('does not treat package names from the log as regexes', () => {
  const evil = `Package (a|a)*b Warning: x\n(${'a'.repeat(40)}`;
  const start = performance.now();
  expect(parseLatexLog(evil).warnings).toEqual([{ message: 'x' }]);
  expect(performance.now() - start).toBeLessThan(100);
  const log = 'Package foo( Warning: bad\n(foo()    more on input line 3.';
  expect(parseLatexLog(log).warnings).toEqual([{ message: 'bad more', line: 3 }]);
});

it('parses file:line errors whose path has a Windows drive letter', () => {
  const log =
    'C:MiKTeX\texlatex\fontspec\fontspec.sty:101: Fatal Package fontspec Error: requires XeTeX\nl.101 msg_fatal:nn';
  expect(parseLatexLog(log).errors).toEqual([
    {
      file: 'C:MiKTeX\texlatex\fontspec\fontspec.sty',
      line: 101,
      message: 'Fatal Package fontspec Error: requires XeTeX',
    },
  ]);
});
