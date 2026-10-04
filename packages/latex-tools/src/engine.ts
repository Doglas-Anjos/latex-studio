export type Engine = 'pdflatex' | 'xelatex' | 'lualatex';

const MAGIC = /^%\s*!\s*TEX\s+(?:TS-)?program\s*=\s*(pdflatex|xelatex|lualatex)/im;
// fontspec and polyglossia refuse pdflatex outright; the rest of the preamble is a weak signal.
const NEEDS_UNICODE_ENGINE =
  /\\(?:usepackage|RequirePackage)\s*(?:\[[^\]]{0,500}\])?\s{0,50}\{[^}]{0,500}\b(?:fontspec|polyglossia|unicode-math)\b/;

/** The engine a main file asks for: its magic comment, else xelatex when it needs one, else null. */
export function detectEngine(source: string): Engine | null {
  const magic = MAGIC.exec(source)?.[1]?.toLowerCase() as Engine | undefined;
  if (magic) return magic;
  return NEEDS_UNICODE_ENGINE.test(source) ? 'xelatex' : null;
}
