const TEXT = 'text/plain; charset=utf-8';
// SVG is left out on purpose: it can carry script, so it downloads as an attachment.
export const CONTENT_TYPES: Record<string, string> = {
  '.tex': TEXT,
  '.bib': TEXT,
  '.sty': TEXT,
  '.cls': TEXT,
  '.txt': TEXT,
  '.md': TEXT,
  '.json': TEXT,
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
};

/**
 * `attachment` for any Unicode file name: the RFC 5987 `filename*` (UTF-8, with `'()*` escaped as
 * attr-char requires), after an ASCII-only `filename` for clients that ignore it. A raw non-Latin-1
 * name in the header would make Node throw.
 */
export const attachment = (name: string): string =>
  `attachment; filename="${name.replace(/[^\x20-\x7e]|["\\]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(
    name,
  ).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`;
