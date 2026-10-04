// \usepackage[opts]{a,b} or \RequirePackage; options optional, spaces tolerated
// Bounded quantifiers: unbounded `[^}]*` scans to the end of the line from every match start,
// which a 1 MB line of `\usepackage{` turns into tens of seconds (ReDoS).
const PACKAGE_CMD =
  /\\(?:usepackage|RequirePackage)\s{0,50}(?:\[([^\]]{0,500})\]\s{0,50})?\{([^}]{0,500})\}/g;
// first % not preceded by a backslash
const COMMENT_START = /(?<!\\)%/;

export function extractUsepackages(source: string): {
  packages: Array<{ name: string; options?: string }>;
  remaining: string;
} {
  const docStart = source.indexOf('\\begin{document}');
  const preamble = docStart === -1 ? source : source.slice(0, docStart);
  const body = docStart === -1 ? '' : source.slice(docStart);

  const packages: Array<{ name: string; options?: string }> = [];
  const kept: string[] = [];
  for (const line of preamble.split('\n')) {
    const cut = line.search(COMMENT_START);
    const code = cut === -1 ? line : line.slice(0, cut);
    const comment = cut === -1 ? '' : line.slice(cut);
    const stripped = code.replace(PACKAGE_CMD, (_m, options: string | undefined, names: string) => {
      for (const name of names
        .split(',')
        .map((n) => n.trim())
        .filter(Boolean)) {
        packages.push(options ? { name, options: options.trim() } : { name });
      }
      return '';
    });
    if (stripped !== code && stripped.trim() === '' && comment === '') continue;
    kept.push(stripped + comment);
  }
  return { packages, remaining: kept.join('\n') + body };
}

/** Every \usepackage/\RequirePackage in code (not comments), one entry per package name. */
export function findUsepackages(
  source: string,
): Array<{ name: string; options?: string; line: number }> {
  const found: Array<{ name: string; options?: string; line: number }> = [];
  source.split('\n').forEach((text, i) => {
    const cut = text.search(COMMENT_START);
    const code = cut === -1 ? text : text.slice(0, cut);
    for (const [, options, names] of code.matchAll(PACKAGE_CMD)) {
      for (const name of (names ?? '')
        .split(',')
        .map((n) => n.trim())
        .filter(Boolean)) {
        found.push(
          options?.trim() ? { name, options: options.trim(), line: i + 1 } : { name, line: i + 1 },
        );
      }
    }
  });
  return found;
}

export function insertPackagesInput(source: string): string {
  const input = '\\input{latex-packages}';
  const lines = source.split('\n');
  const isCode = (re: RegExp) => (l: string) => re.test(l.split(COMMENT_START)[0] ?? '');
  if (lines.some(isCode(/\\input\s*\{latex-packages\}/))) return source;
  const i = lines.findIndex(isCode(/\\documentclass/));
  if (i === -1) return source;
  lines.splice(i + 1, 0, lines[i]?.endsWith('\r') ? `${input}\r` : input);
  return lines.join('\n');
}
