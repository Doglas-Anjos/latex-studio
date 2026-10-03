const hasDocumentclass = (content: string) =>
  content.split('\n').some((l) => /\\documentclass/.test(l.split(/(?<!\\)%/)[0] ?? ''));

export function findMainFile(files: Iterable<[path: string, content: string]>): string | null {
  let first: string | null = null;
  for (const [path, content] of files) {
    if (path === 'main.tex' && hasDocumentclass(content)) return path;
    if (first === null && path.endsWith('.tex') && hasDocumentclass(content)) first = path;
  }
  return first;
}
