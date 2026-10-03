// \usepackage[opts]{a,b} or \RequirePackage; options optional, spaces tolerated
const PACKAGE_CMD = /\\(?:usepackage|RequirePackage)\s*(?:\[([^\]]*)\])?\s*\{([^}]*)\}/g;
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
