import { expect, it } from 'vitest';
import { parseLatexLog } from './log-parser';

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
  const { errors, warnings } = parseLatexLog(log);
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
