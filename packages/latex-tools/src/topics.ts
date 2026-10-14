// The "Grafo de assuntos": the document as areas of interest. Terms that run through the whole
// document ring the root (its overall subject). The rest are grouped into areas by how often they
// share a paragraph: cosine co-occurrence → k-nearest-neighbour graph → modularity communities.
// Each area's hub is its most central term (the broad subject), ringed by its more specific terms.
// ponytail: statistics, not semantics — no language model, no stemming beyond -s plurals, and an
// area is named by its central term rather than a human category (that needs embeddings/an LLM).

export type SubjectKind = 'root' | 'hub' | 'term';
export interface SubjectNode {
  id: string;
  label: string;
  kind: SubjectKind;
  /** Paragraphs that mention the term (0 for the root). */
  count: number;
  /** Where a click jumps: the term's first use. */
  path?: string;
  line?: number;
}
export interface SubjectGraph {
  nodes: SubjectNode[];
  links: { source: string; target: string; weight: number }[];
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
    'rather enough instead yet still even though toward towards able let get make made allows allow ' +
    'cited proposed propose paper papers work works study studies author authors yes ' +
    'apply applies applied conducted already reported observed obtained considered presented ' +
    'described provide provides provided related respect case cases order number set part point way ' +
    'type types kind important different possible available similar full best'
  ).split(/\s+/),
);

// The text is untrusted and parsed on the API's event loop: bounded quantifiers, and spans from an
// opener to its closer are found by blankSpans, never by a lazy `[\s\S]*?` that rescans to the end
// of the text from every unclosed opener (ReDoS).

// Environments holding maths, data, drawings or code rather than prose, and front matter (abstracts,
// acronym and symbol lists) that restates every subject at once.
const NON_PROSE_ENV =
  /\\begin\{(?:equation|align|gather|multline|displaymath|math|tabularx?|longtable|tikzpicture|pgfpicture|ganttchart|forest|algorithm|algorithmic|verbatim|lstlisting|minted|abstract|resumo|resumen|siglas|simbolos|fichacatalografica)\*?\}/g;
// Glossary definitions.
const GLOSSARY_DEF = /^[ \t]*\\new(?:acronym|glossaryentry|abbreviation)\b[^\n]*/gm;
// Inline and display maths.
const MATH = /\$\$|\$|\\\[|\\\(/g;
// The closer of each MATH opener; `$$` and `$` close themselves.
const CLOSER: Record<string, string> = { '\\[': '\\]', '\\(': '\\)' };
// Glossary uses (\acrshort{moo}, \gls{emd}…): the document's own declared key concepts.
const ACRONYM = /\\(?:acr(?:short|long|full)|[gG]ls[a-z]*)\{([^}]{1,40})\}/g;
// Commands whose (first) argument is a key, path, colour or name, never prose: \cite{..}, \ref{..},
// \label{..}, \url{..}, \cellcolor[HTML]{..}… A following prose argument (\href{url}{text}) stays.
const KEY_ARG =
  /\\(?:[a-zA-Z]{0,20}cite[a-zA-Z]{0,20}|[a-zA-Z]{0,20}ref|label|url|includegraphics|input|include|bibliography(?:style)?|usepackage|documentclass|begin|end|(?:cell|row|column|text|page)?color|definecolor|[hv]space|setlength|newcommand|renewcommand)\*?\s*(?:\[[^\]]{0,300}\]\s*)*\{[^}]{0,500}\}/g;

const blank = (s: string) => s.replace(/[^\n]/g, ' ');

/**
 * `text` with each span from an `open` match to the first `closeOf(match)` after it blanked (newlines
 * kept), like replacing a global `open[\s\S]*?close`. Linear: once a closer is missing, no later
 * opener can find one either, so they are left alone instead of each scanning to the end.
 */
function blankSpans(text: string, open: RegExp, closeOf: (open: string) => string): string {
  const missing = new Set<string>();
  let out = '';
  let last = 0;
  open.lastIndex = 0;
  for (let m = open.exec(text); m; m = open.exec(text)) {
    const close = closeOf(m[0]);
    const end = missing.has(close) ? -1 : text.indexOf(close, open.lastIndex);
    if (end === -1) {
      missing.add(close);
      continue;
    }
    open.lastIndex = end + close.length;
    out += text.slice(last, m.index) + blank(text.slice(m.index, open.lastIndex));
    last = open.lastIndex;
  }
  return out + text.slice(last);
}

/** Strip LaTeX down to readable prose: comments, maths/data, keys, commands and braces removed. */
function toProse(tex: string): string {
  return blankSpans(tex.replace(/(?<!\\)%[^\n]*/g, ' '), MATH, (o) => CLOSER[o] ?? o)
    .replace(KEY_ARG, ' ')
    .replace(/\\[a-zA-Z]+\*?(\s*\[[^\]]{0,300}\])?/g, ' ') // command + optional [..]; keeps {..} text
    .replace(/[{}~\\]/g, ' ');
}

const WORD = /\p{L}[\p{L}-]*/gu;
// Short words ("so", "of", "is") are skipped like stopwords but still break a bigram: dropping them
// first would glue "conducted so far" into "conducted far".
const skip = (w: string) => w.length < 3 || STOP.has(w);

/** Non-stop words plus bigrams of adjacent non-stop words, never across punctuation. */
function terms(tex: string): string[] {
  const out = [...tex.matchAll(ACRONYM)].map((m) => (m[1] as string).trim().toLowerCase());
  for (const clause of toProse(tex).split(/[.,;:!?()[\]]+/)) {
    const tokens = clause.toLowerCase().match(WORD) ?? [];
    for (let i = 0; i < tokens.length; i++) {
      const w = tokens[i] as string;
      if (skip(w)) continue;
      out.push(w);
      const n = tokens[i + 1];
      if (n && !skip(n)) out.push(`${w} ${n}`);
    }
  }
  return out;
}

/** Phrases name a subject better than single words ("time series" over "time"): rank them higher. */
const phrase = (t: string) => (t.includes(' ') ? 1.5 : 1);

/** Top `k` by score; a word that mostly appears inside a picked phrase ("wind" in "wind speed") is dropped. */
function pick(ranked: [term: string, count: number, score: number][], k: number) {
  ranked.sort((a, b) => b[2] - a[2]);
  const count = new Map(ranked.map(([t, c]) => [t, c]));
  const covers = (p: string, word: string) =>
    p.split(' ').includes(word) &&
    (count.get(p) ?? 0) >= 0.6 * (count.get(word) ?? Number.POSITIVE_INFINITY);
  const out: [string, number][] = [];
  for (const [t, c] of ranked) {
    if (out.length >= k) break;
    if (out.some(([p]) => covers(p, t))) continue;
    for (let j = out.length - 1; j >= 0; j--)
      if (covers(t, (out[j] as [string, number])[0])) out.splice(j, 1);
    out.push([t, c]);
  }
  return out;
}

interface Paragraph {
  path: string;
  start: number;
  lines: string[];
  terms: Set<string>;
}

/** Blank-line separated paragraphs, with maths/data/drawings blanked first (line numbers kept). */
function paragraphs(files: { path: string; source: string }[]): Paragraph[] {
  const out: Paragraph[] = [];
  for (const f of files) {
    const endOf = (begin: string) => begin.replace('\\begin', '\\end');
    const lines = blankSpans(f.source.replace(GLOSSARY_DEF, blank), NON_PROSE_ENV, endOf).split(
      '\n',
    );
    let start = 0;
    for (let i = 0; i <= lines.length; i++) {
      if (i < lines.length && (lines[i] as string).trim() !== '') continue;
      if (i > start) {
        const body = lines.slice(start, i);
        out.push({
          path: f.path,
          start: start + 1,
          lines: body,
          terms: new Set(terms(body.join('\n'))),
        });
      }
      start = i + 1;
    }
  }
  return out;
}

/**
 * Modularity communities (the local-moving phase of Louvain), visiting nodes in `order` so the
 * result is deterministic. Starting from `initial` (the last run's areas) instead of singletons
 * makes it evolutionary: a term only changes area when the new text clearly pulls it elsewhere.
 * Returns node → community id.
 */
function communities(
  adj: Map<string, Map<string, number>>,
  order: string[],
  initial = new Map<string, string>(),
) {
  const deg = new Map(
    order.map((t) => [t, [...(adj.get(t)?.values() ?? [])].reduce((a, b) => a + b, 0)]),
  );
  const m2 = [...deg.values()].reduce((a, b) => a + b, 0) || 1;
  const comm = new Map(order.map((t) => [t, initial.get(t) ?? t]));
  const tot = new Map<string, number>();
  for (const t of order) {
    const c = comm.get(t) as string;
    tot.set(c, (tot.get(c) ?? 0) + (deg.get(t) ?? 0));
  }
  for (let pass = 0; pass < 20; pass++) {
    let moved = false;
    for (const t of order) {
      const k = deg.get(t) ?? 0;
      const from = comm.get(t) as string;
      tot.set(from, (tot.get(from) ?? 0) - k);
      const toward = new Map<string, number>();
      for (const [u, w] of adj.get(t) ?? []) {
        const c = comm.get(u) as string;
        toward.set(c, (toward.get(c) ?? 0) + w);
      }
      const gain = (c: string) => (toward.get(c) ?? 0) - ((tot.get(c) ?? 0) * k) / m2;
      let best = from;
      for (const c of toward.keys()) if (gain(c) > gain(best) + 1e-12) best = c;
      comm.set(t, best);
      tot.set(best, (tot.get(best) ?? 0) + k);
      if (best !== from) moved = true;
    }
    if (!moved) break;
  }
  return comm;
}

/**
 * How many areas, and terms per area, a document of `paragraphs` paragraphs gets: a short article
 * ~3 x 5, a thesis (~400 paragraphs) ~7 x 8, a book up to 12 x 10.
 */
export function autoSize(paragraphs: number): { areas: number; perArea: number } {
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(v)));
  return { areas: clamp(paragraphs / 60, 3, 12), perArea: clamp(4 + paragraphs / 100, 5, 10) };
}

/**
 * The subject map of `files`, plus every pooled term's area (term → hub) to pass back as
 * `previous` next time, so the map evolves with the text instead of being regrouped from scratch.
 * `areas`/`perArea` fix the size; left undefined they scale with the document (autoSize).
 */
export function subjectGraph(
  files: { path: string; source: string }[],
  title: string,
  options: {
    areas?: number | undefined;
    perArea?: number | undefined;
    previous?: Map<string, string>;
  } = {},
): { graph: SubjectGraph; areas: Map<string, string> } {
  const paras = paragraphs(files);
  const auto = autoSize(paras.length);
  const areas = options.areas ?? auto.areas;
  const perArea = options.perArea ?? auto.perArea;
  const previous = options.previous ?? new Map<string, string>();
  // "models" → "model" when the singular also occurs.
  const seen = new Set(paras.flatMap((p) => [...p.terms]));
  const canon = (t: string) => (/[^su]s$/.test(t) && seen.has(t.slice(0, -1)) ? t.slice(0, -1) : t);
  for (const p of paras) p.terms = new Set([...p.terms].map(canon));

  const df = new Map<string, number>();
  for (const p of paras) for (const t of p.terms) df.set(t, (df.get(t) ?? 0) + 1);
  const count = (t: string) => df.get(t) ?? 0;
  // Enough candidate terms to fill every area, with room for the ones clustering leaves out.
  const poolSize = Math.max(100, areas * (perArea + 4));
  const vocab = [...df.keys()]
    .filter((t) => count(t) >= 3)
    .sort((a, b) => count(b) - count(a) || (a < b ? -1 : 1))
    .slice(0, poolSize + 50);

  // Terms in a large share of paragraphs are the document's overall subject, not an area. The cut
  // adapts to the document: twice the median share, and never below 15%.
  const share = (t: string) => count(t) / (paras.length || 1);
  const shares = vocab.map(share).sort((a, b) => a - b);
  const cut = Math.max(0.15, 2 * (shares[Math.floor(shares.length / 2)] ?? 0));
  const general = pick(
    vocab
      .filter((t) => share(t) >= cut)
      .map((t): [string, number, number] => [t, count(t), count(t) * phrase(t)]),
    6,
  );
  const pool = vocab.filter((t) => share(t) < cut).slice(0, poolSize);

  // Cosine co-occurrence between pooled terms, kept as each term's 5 nearest neighbours. Pairs are
  // counted in a pool² array (string keys took seconds on long documents of long paragraphs), and
  // `pairs` keeps their first-seen order, which breaks ties between equal cosines below.
  const index = new Map(pool.map((t, i) => [t, i]));
  const n = pool.length;
  const co = new Uint32Array(n * n);
  const pairs: number[] = [];
  for (const p of paras) {
    const present = [...p.terms]
      .filter((t) => index.has(t))
      .sort()
      .map((t) => index.get(t) as number);
    for (let i = 0; i < present.length; i++)
      for (let j = i + 1; j < present.length; j++) {
        const key = (present[i] as number) * n + (present[j] as number);
        if (!co[key]) pairs.push(key);
        co[key] = (co[key] ?? 0) + 1;
      }
  }
  const near = new Map<string, [string, number][]>(pool.map((t) => [t, []]));
  for (const key of pairs) {
    const c = co[key] as number;
    if (c < 2) continue;
    const a = pool[Math.floor(key / n)] as string;
    const b = pool[key % n] as string;
    const cos = c / Math.sqrt(count(a) * count(b));
    near.get(a)?.push([b, cos]);
    near.get(b)?.push([a, cos]);
  }
  const adj = new Map<string, Map<string, number>>(pool.map((t) => [t, new Map()]));
  for (const [a, list] of near)
    for (const [b, cos] of list.sort((x, y) => y[1] - x[1]).slice(0, 5)) {
      adj.get(a)?.set(b, Math.max(adj.get(a)?.get(b) ?? 0, cos));
      adj.get(b)?.set(a, Math.max(adj.get(b)?.get(a) ?? 0, cos));
    }

  const comm = communities(adj, pool, previous);
  const groups = new Map<string, string[]>();
  for (const t of pool)
    if ((adj.get(t)?.size ?? 0) > 0)
      groups.set(comm.get(t) as string, [...(groups.get(comm.get(t) as string) ?? []), t]);
  const ranked = [...groups.values()]
    .filter((g) => g.length >= 3)
    .sort((a, b) => b.reduce((s, t) => s + count(t), 0) - a.reduce((s, t) => s + count(t), 0))
    .slice(0, areas);

  // Where a click lands: the paragraph using the term together with the most of its closest
  // neighbours in its area (its main discussion, not a passing mention); ties go to the earliest.
  const mainUse = (t: string, area: string[]) => {
    const near = area.filter((u) => adj.get(t)?.has(u));
    const related = near.length ? near : area;
    let best: Paragraph | undefined;
    let score = -1;
    for (const p of paras) {
      if (!p.terms.has(t)) continue;
      const s = related.filter((u) => p.terms.has(u)).length;
      if (s > score) [best, score] = [p, s];
    }
    if (!best) return {};
    const i = best.lines.findIndex((l) => l.toLowerCase().includes(t));
    return { path: best.path, line: best.start + Math.max(0, i) };
  };
  const node = (id: string, t: string, kind: SubjectKind, area: string[]): SubjectNode => ({
    id,
    label: t,
    kind,
    count: count(t),
    ...mainUse(t, area),
  });

  const nodes: SubjectNode[] = [{ id: 'root', label: title, kind: 'root', count: 0 }];
  const links: SubjectGraph['links'] = [];
  const generalTerms = general.map(([t]) => t);
  for (const [t, c] of general) {
    nodes.push(node(`t:${t}`, t, 'term', generalTerms));
    links.push({ source: 'root', target: `t:${t}`, weight: c });
  }
  const previousHubs = new Set(previous.values());
  const membership = new Map<string, string>();
  for (const group of ranked) {
    // How tightly a term is bound to this area (its neighbour weight inside the group).
    const affinity = (t: string) => group.reduce((s, u) => s + (adj.get(t)?.get(u) ?? 0), 0);
    // The hub is the area's most central term: well connected inside it and frequent…
    const central = [...group].sort(
      (a, b) =>
        affinity(b) * Math.sqrt(count(b)) - affinity(a) * Math.sqrt(count(a)) || (a < b ? -1 : 1),
    )[0] as string;
    // …named by its phrase when the word mostly appears in one ("front" → "pareto front")…
    const named =
      group
        .filter((t) => t.split(' ').length > 1 && t.split(' ').includes(central))
        .filter((t) => count(t) >= 0.45 * count(central))
        .sort((a, b) => count(b) - count(a))[0] ?? central;
    // …unless the area already had a name that is still in it: an area keeps its name.
    const hub =
      group.filter((t) => previousHubs.has(t)).sort((a, b) => count(b) - count(a))[0] ?? named;
    for (const t of group) membership.set(t, hub);
    nodes.push(node(`h:${hub}`, hub, 'hub', group));
    links.push({ source: 'root', target: `h:${hub}`, weight: 1 });
    // Its words are redundant next to a phrase hub ("wind" around "wind speed").
    const rest = group.filter((t) => t !== hub && !hub.split(' ').includes(t));
    // Satellites are the terms most bound to the area, not merely the most frequent.
    const sats = pick(
      rest.map((t): [string, number, number] => [t, count(t), affinity(t) * phrase(t)]),
      perArea,
    );
    for (const [t] of sats) {
      nodes.push(node(`t:${t}`, t, 'term', group));
      links.push({ source: `h:${hub}`, target: `t:${t}`, weight: adj.get(hub)?.get(t) ?? 0 });
    }
  }
  return { graph: { nodes, links }, areas: membership };
}
