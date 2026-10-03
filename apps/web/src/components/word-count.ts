/** Rough LaTeX word count: drops %comments and \commands, counts letter runs. */
export function approxWords(src: string): number {
  return (
    src
      .replace(/(^|[^\\])%.*$/gm, '$1')
      .replace(/\\[a-zA-Z@]+\*?/g, ' ')
      .match(/\p{L}+/gu)?.length ?? 0
  );
}
