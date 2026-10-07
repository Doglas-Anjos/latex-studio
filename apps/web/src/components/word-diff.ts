import { diff } from '@codemirror/merge';

/** Words, single punctuation marks, or runs of whitespace. */
const TOKEN = /\s+|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu;

export type WordPart =
  | { type: 'same'; text: string }
  | {
      type: 'change';
      removed: string;
      added: string;
      /** Character offsets of `removed` in the old text and `added` in the new one. */
      fromA: number;
      toA: number;
      fromB: number;
      toB: number;
    };

/**
 * Word-level diff for prose. Runs on tokens rather than characters, so a change reads as whole
 * words ("work" → "study", not "w[o→st]..."). Whitespace counts as one kind, except a blank line
 * (a LaTeX paragraph break): re-wrapping a paragraph is not a change, splitting one is.
 * ponytail: tokens are encoded one per UTF-16 unit, so past ~61k distinct tokens later ones share
 * a code and may diff as equal; a token-array diff would lift that.
 */
export function wordDiff(a: string, b: string, limits?: { scanLimit?: number; timeout?: number }) {
  const ta = a.match(TOKEN) ?? [];
  const tb = b.match(TOKEN) ?? [];
  const codes = new Map<string, string>();
  let next = 0x100;
  const encode = (tokens: string[]) =>
    tokens
      .map((t) => {
        const key = /^\s/.test(t) ? (/\n[^\S\n]*\n/.test(t) ? '\n\n' : ' ') : t;
        let code = codes.get(key);
        if (!code) {
          if (next === 0xd800) next = 0xe000; // skip surrogates: one token, one code unit
          code = String.fromCharCode(Math.min(next++, 0xffff));
          codes.set(key, code);
        }
        return code;
      })
      .join('');
  // Character offset where each token starts (plus the end), to map token ranges back to text.
  const starts = (tokens: string[]) => {
    const out = [0];
    for (const t of tokens) out.push((out.at(-1) as number) + t.length);
    return out;
  };
  const sa = starts(ta);
  const sb = starts(tb);
  const parts: WordPart[] = [];
  let posB = 0; // token index in b already emitted
  for (const c of diff(encode(ta), encode(tb), limits)) {
    if (c.fromB > posB) parts.push({ type: 'same', text: tb.slice(posB, c.fromB).join('') });
    parts.push({
      type: 'change',
      removed: ta.slice(c.fromA, c.toA).join(''),
      added: tb.slice(c.fromB, c.toB).join(''),
      fromA: sa[c.fromA] as number,
      toA: sa[c.toA] as number,
      fromB: sb[c.fromB] as number,
      toB: sb[c.toB] as number,
    });
    posB = c.toB;
  }
  if (posB < tb.length) parts.push({ type: 'same', text: tb.slice(posB).join('') });
  return parts;
}
