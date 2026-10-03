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
