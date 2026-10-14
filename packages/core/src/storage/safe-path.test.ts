import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SafePath } from './safe-path';

const root = path.join('C:', 'repos', 'p1');
const safe = new SafePath(root);

describe('SafePath.resolve', () => {
  it('joins valid relative paths under the root', () => {
    expect(safe.resolve('chapters/intro.tex')).toBe(path.join(root, 'chapters', 'intro.tex'));
  });

  it.each([
    '../x.tex',
    '/etc/passwd',
    'a/../../b',
    'a//b',
    '.git/config',
    '.GIT/config',
    '.gitignore',
    'sub/.gitmodules',
    'a\b',
    'a\0b',
    '',
    'name.',
    'name ',
    'NUL',
    'nul.tex',
    'Com1',
    'lpt9.txt',
    'x'.repeat(201),
    '.',
    '..',
    '...',
    'C:\\x',
    'C:foo',
    '\\\\srv\\share',
    '.Git',
    '.github/x',
    'GIT~1',
    'a.tex:ads',
    'CONIN$',
    'con .tex',
    'COM0',
    // Unicode: non-NFC, NFKC twins of forbidden names, lookalike separators, invisible characters.
    'introduc\u0327a\u0303o.tex',
    'COM\u00b9.tex',
    '\uff23\uff2f\uff2e',
    '.\uff47\uff49\uff54',
    '\uff0e\uff0e',
    'a\u2215b',
    'a\uff0fb',
    '\u00bd.tex',
    'a\u202eb',
    'a\u200bb',
    'a\u00a0b',
    'a\u2028b',
    '\u00e7'.repeat(101),
  ])('rejects %j', (p) => expect(() => safe.resolve(p)).toThrow(/Invalid path/));

  it.each([
    'console.tex',
    'auxiliary.tex',
    'com10',
    'my.git.tex',
    'x'.repeat(200),
    'introdução.tex',
    'résumé.tex',
    'fig+1.png',
    'capítulo 1/seção (a).tex',
    '日本語.tex',
    'हिन्दी.tex',
    '\u00e7'.repeat(100),
  ])('accepts %j', (p) => expect(() => safe.resolve(p)).not.toThrow());
});

describe('SafePath.resolveExisting', () => {
  it.skipIf(process.platform === 'win32')(
    'rejects symlinks pointing outside the root',
    async () => {
      const base = await mkdtemp(path.join(tmpdir(), 'safepath-'));
      const inside = path.join(base, 'root');
      await mkdir(inside);
      await writeFile(path.join(base, 'secret.txt'), 'x');
      await symlink(path.join(base, 'secret.txt'), path.join(inside, 'link.txt'), 'file');
      const sp = new SafePath(inside);
      await expect(sp.resolveExisting('link.txt')).rejects.toThrow(/Invalid path/);
    },
  );
});
