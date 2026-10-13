// A lightweight "subject graph" of a document: frequent terms (uni- and bigrams) as nodes, linked
// when they co-occur in the same paragraph. ponytail: frequency + co-occurrence, not semantic NLP —
// no model, no stemming; good enough to see what a document is about and how its topics cluster.

export interface TopicGraph {
  nodes: { term: string; count: number }[];
  edges: { a: string; b: string; weight: number }[];
}

// Portuguese + English function words and a few LaTeX/academic fillers that are never topics.
const STOP = new Set(
  (
    'a o e de da do das dos em no na nos nas um uma uns umas para por com sem sob sobre entre ' +
    'que se ao aos à às como mais menos muito pouco já não sim ou nem são foi ser está estão este ' +
    'esta esse essa isso aquele aquela seu sua seus suas nosso nossa quando onde qual quais cada ' +
    'the a an and or of to in on at for with without from by as is are was were be been being this ' +
    'that these those it its their our his her we they you he she him them can may might will would ' +
    'should could has have had do does did not but if then than so such which who whom whose into ' +
    'also other each per via using used use based given figure table section chapter equation eq fig ' +
    'et al cite ref label where between among both only same thus hence however therefore ' +
    'one two three four first second third new many most much more less well often since upon along ' +
    'around across over under above below before after during while because although whether within ' +
    'through out off out up down here there when what how why all any some none every several ' +
    'respectively eg ie etc shown show shows results result method methods approach data value values ' +
    'rather enough instead yet still even though toward towards able let get make made allows allow'
  ).split(/\s+/),
);

/** Strip LaTeX down to readable prose: comments, math, commands and braces removed. */
function toProse(tex: string): string {
  return tex
    .replace(/(?<!\\)%[^\n]*/g, ' ')
    .replace(
      /\\begin\{(equation|align|gather|multline|displaymath|math)\*?\}[\s\S]*?\\end\{\1\*?\}/g,
      ' ',
    )
    .replace(/\$\$[\s\S]*?\$\$|\$[^$]*\$|\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)/g, ' ')
    .replace(/\\[a-zA-Z]+\*?(\s*\[[^\]]*\])?/g, ' ') // command + optional [..]; keeps {..} text
    .replace(/[{}~\\]/g, ' ');
}

const WORD = /\p{L}[\p{L}-]*/gu;
const tokenize = (prose: string): string[] =>
  (prose.toLowerCase().match(WORD) ?? []).filter((w) => w.length > 2);

/** Terms in one segment: non-stop unigrams plus bigrams of adjacent non-stop words. */
function terms(tokens: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const w = tokens[i] as string;
    if (STOP.has(w)) continue;
    out.push(w);
    const n = tokens[i + 1];
    if (n && !STOP.has(n)) out.push(`${w} ${n}`);
  }
  return out;
}

export function extractTopics(tex: string, maxNodes = 28): TopicGraph {
  // Paragraphs (blank-line separated) are the co-occurrence unit.
  const segments = toProse(tex)
    .split(/\n\s*\n/)
    .map((s) => [...new Set(terms(tokenize(s)))])
    .filter((t) => t.length > 0);

  const count = new Map<string, number>();
  for (const seg of segments) for (const t of seg) count.set(t, (count.get(t) ?? 0) + 1);

  // Keep the strongest terms (count >= 2); a bigram usually outranks its weaker halves.
  const top = [...count.entries()]
    .filter(([, c]) => c >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxNodes);
  const keep = new Set(top.map(([t]) => t));

  const edgeW = new Map<string, number>();
  for (const seg of segments) {
    const present = seg.filter((t) => keep.has(t)).sort();
    for (let i = 0; i < present.length; i++)
      for (let j = i + 1; j < present.length; j++) {
        const key = `${present[i]}\u0000${present[j]}`;
        edgeW.set(key, (edgeW.get(key) ?? 0) + 1);
      }
  }
  // Keep the strongest links (co-occurring at least twice), capped at ~2.5 per node so the graph
  // reads as clusters rather than a hairball.
  const edges = [...edgeW.entries()]
    .filter(([, w]) => w >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, Math.round(top.length * 2.5))
    .map(([key, weight]) => {
      const [a, b] = key.split('\u0000');
      return { a: a as string, b: b as string, weight };
    });

  return { nodes: top.map(([term, c]) => ({ term, count: c })), edges };
}
