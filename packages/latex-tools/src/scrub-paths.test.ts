import { describe, expect, it } from 'vitest';
import { parseLatexLog } from './log-parser';
import { scrubLogPaths } from './scrub-paths';

describe('scrubLogPaths', () => {
  it('makes paths inside the build copy project-relative, in either separator style', () => {
    const win = String.raw`C:\Users\ana\AppData\Local\Temp\ls-build-abc`;
    const log = [
      String.raw`(C:\Users\ana\AppData\Local\Temp\ls-build-abc/capitulos/cap_01.tex`,
      'c:/users/ana/appdata/local/temp/ls-build-abc/out/main.aux',
    ].join('\n');
    expect(scrubLogPaths(log, win)).toBe('(capitulos/cap_01.tex\nout/main.aux');
    expect(scrubLogPaths('(/tmp/ls-build-x1/main.tex) ', '/tmp/ls-build-x1')).toBe('(main.tex) ');
  });

  it('keeps only the file name of other absolute paths', () => {
    const log = [
      String.raw`(C:\Users\ana\AppData\Local\Programs\MiKTeX\tex/generic/babel\babel.sty`,
      '(/usr/local/texlive/2026/texmf-dist/tex/latex/base/article.cls',
      'Font cache in /tmp/ls-home-9/texmf-var/luatex-cache/x.lua',
    ].join('\n');
    expect(scrubLogPaths(log, '/tmp/ls-build-x1')).toBe(
      '(babel.sty\n(article.cls\nFont cache in x.lua',
    );
  });

  it('leaves URLs, font shapes and relative paths alone', () => {
    const log = [
      'See https://github.com/abntex/abntex2/issues/176 for details.',
      "LaTeX Font Warning: Font shape `OT1/cmr/m/n' undefined",
      './main.tex:12: Undefined control sequence.',
      'File: img/cap_03/fig.png Graphic file (type png)',
    ].join('\n');
    expect(scrubLogPaths(log, '/tmp/ls-build-x1')).toBe(log);
  });

  it('feeds the parser a file name, not a server path', () => {
    const log = String.raw`C:\Users\ana\AppData\Local\Programs\MiKTeX\tex/latex/abntex2\abntex2.cls:483: LaTeX Error: Something broke.`;
    const { errors } = parseLatexLog(scrubLogPaths(log, '/tmp/x'));
    expect(errors[0]?.file).toBe('abntex2.cls');
  });
});
