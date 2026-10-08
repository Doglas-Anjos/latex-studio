const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const SEP = String.raw`[\\/]`;

/**
 * An absolute path's directories: a drive (`C:\`, `C:/`) or a leading `/` followed by one or more
 * segments ending in a separator. Not after a word, `.`, `:` or a separator, so URLs
 * (`https://a/b`), font shapes (`OT1/cmr/m/n`) and relative paths (`./main.tex`, `img/a.png`) are
 * left alone.
 */
const ABSOLUTE_DIRS =
  /(?<![\w.:/\\])(?:[A-Za-z]:[\\/]|\/(?=[^\s/]))(?:[^\s()[\]{}<>"'|,;]*[\\/])+/g;

/**
 * Removes server paths from a TeX log before anyone sees it. Paths inside the build's working copy
 * become project-relative (`/tmp/ls-build-x/capitulos/a.tex` -> `capitulos/a.tex`); any other
 * absolute path (the TeX distribution, temp dirs, the account running the worker) keeps only its
 * file name (`/usr/local/texlive/.../babel.sty` -> `babel.sty`).
 * ponytail: a path with a space in a directory name (`C:\Program Files\...`) is only cut up to the
 * space; the containers and the default per-user MiKTeX install have none.
 */
export function scrubLogPaths(log: string, workDir: string): string {
  // Either separator, any case: MiKTeX prints `C:\...\ls-build-x/out/main.aux`.
  const segments = workDir
    .split(/[\\/]+/)
    .filter(Boolean)
    .map(escapeRegExp);
  const root = `${workDir.startsWith('/') ? SEP : ''}${segments.join(SEP)}${SEP}`;
  return log.replace(new RegExp(root, 'gi'), '').replace(ABSOLUTE_DIRS, '');
}
