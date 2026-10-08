export type Align = 'l' | 'c' | 'r';
/** Spans live on the top-left cell; covered cells stay in the grid (their text is ignored). */
export interface Cell {
  text: string;
  colspan?: number;
  rowspan?: number;
}
export interface TableModel {
  rows: Cell[][];
  align: Align[];
}
export type TableStyle = 'booktabs' | 'grid' | 'lines' | 'plain';
export interface TableOptions {
  style: TableStyle;
  header: boolean;
  float: boolean;
  position: string;
  caption: string;
  label: string;
  source: string;
  escape: boolean;
}

export const DEFAULT_OPTIONS: TableOptions = {
  style: 'booktabs',
  header: true,
  float: true,
  position: 'htbp',
  caption: '',
  label: '',
  source: '',
  escape: true,
};

const mk = (text: string, colspan = 1, rowspan = 1): Cell => ({
  text,
  ...(colspan > 1 && { colspan }),
  ...(rowspan > 1 && { rowspan }),
});

export function emptyTable(rows: number, cols: number): TableModel {
  return {
    rows: Array.from({ length: rows }, () => Array.from({ length: cols }, () => mk(''))),
    align: Array.from({ length: cols }, () => 'c' as const),
  };
}

export function coveredBy(t: TableModel): ([number, number] | null)[][] {
  const out = t.rows.map((r) => r.map((): [number, number] | null => null));
  t.rows.forEach((row, r) => {
    row.forEach((cell, c) => {
      for (let i = 0; i < (cell.rowspan ?? 1); i++) {
        for (let j = 0; j < (cell.colspan ?? 1); j++) {
          const target = out[r + i];
          if ((i || j) && target && c + j < target.length) target[c + j] = [r, c];
        }
      }
    });
  });
  return out;
}

const ESCAPES: Record<string, string> = {
  '\\': '\\textbackslash{}',
  '&': '\\&',
  '%': '\\%',
  $: '\\$',
  '#': '\\#',
  _: '\\_',
  '{': '\\{',
  '}': '\\}',
  '~': '\\textasciitilde{}',
  '^': '\\textasciicircum{}',
};
const escapeTex = (s: string) => s.replace(/[\\&%$#_{}~^]/g, (ch) => ESCAPES[ch] ?? ch);

export function toLatex(t: TableModel, o: TableOptions): { code: string; packages: string[] } {
  const cov = coveredBy(t);
  const grid = o.style === 'grid';
  const cols = t.align.length;
  const text = (s: string) => (o.escape ? escapeTex(s) : s);
  const multicol = (n: number, c: number, content: string) =>
    `\\multicolumn{${n}}{${grid && c === 0 ? '|' : ''}${t.align[c]}${grid ? '|' : ''}}{${content}}`;

  const rule = (r: number): string[] => {
    if (o.style === 'plain') return [];
    const last = r === t.rows.length - 1;
    if (r < 0 || last) {
      return [o.style !== 'booktabs' ? '\\hline' : r < 0 ? '\\toprule' : '\\bottomrule'];
    }
    if (o.style === 'booktabs') return o.header && r === 0 ? ['\\midrule'] : [];
    if (!grid) return o.header && r === 0 ? ['\\hline'] : [];
    // Columns crossed by a rowspan that started on or above row r.
    const open = (cov[r + 1] ?? []).map((v) => !!v && v[0] <= r);
    if (!open.some(Boolean)) return ['\\hline'];
    const runs: string[] = [];
    for (let c = 0; c < cols; c++) {
      if (open[c]) continue;
      let e = c;
      while (e + 1 < cols && !open[e + 1]) e++;
      runs.push(`\\cline{${c + 1}-${e + 1}}`);
      c = e;
    }
    return runs;
  };

  const body: string[] = [...rule(-1)];
  t.rows.forEach((row, r) => {
    const cells: string[] = [];
    for (let c = 0; c < cols; c++) {
      const cell = row[c] ?? mk('');
      const cs = cell.colspan ?? 1;
      const rs = cell.rowspan ?? 1;
      const origin = cov[r]?.[c];
      if (origin) {
        // Covered by a rowspan above (colspan-covered cells are skipped below).
        const ocs = t.rows[origin[0]]?.[origin[1]]?.colspan ?? 1;
        cells.push(ocs > 1 ? multicol(ocs, c, '') : '');
        c += ocs - 1;
        continue;
      }
      let content = text(cell.text);
      if (rs > 1) content = `\\multirow{${rs}}{*}{${content}}`;
      if (cs > 1) content = multicol(cs, c, content);
      cells.push(content);
      c += cs - 1;
    }
    body.push(`${cells.join(' & ')} \\\\`, ...rule(r));
  });

  const ind = o.float ? '  ' : '';
  const spec = grid ? `|${t.align.join('|')}|` : t.align.join('');
  const tabular = [`\\begin{tabular}{${spec}}`, ...body.map((l) => `  ${l}`), '\\end{tabular}'].map(
    (l) => ind + l,
  );

  let lines = tabular;
  if (o.float) {
    lines = [
      `\\begin{table}${o.position ? `[${o.position}]` : ''}`,
      '  \\centering',
      ...(o.caption ? [`  \\caption{${o.caption}}`] : []),
      ...(o.label ? [`  \\label{${o.label}}`] : []),
      ...tabular,
      ...(o.source ? [`  \\fonte{${o.source}}`] : []),
      '\\end{table}',
    ];
  }

  const flat = t.rows.flat();
  const packages = [
    ...(o.style === 'booktabs' ? ['booktabs'] : []),
    ...(flat.some((c) => (c.rowspan ?? 1) > 1) ? ['multirow'] : []),
    ...(o.float && o.position.includes('H') ? ['float'] : []),
  ].sort();
  return { code: lines.join('\n'), packages };
}

/** Balanced `{...}` starting at s[i]; returns its content and the index after the closing brace. */
function readGroup(s: string, i: number): [string, number] | null {
  if (s[i] !== '{') return null;
  let depth = 0;
  for (let j = i; j < s.length; j++) {
    const ch = s[j];
    if (ch === '\\') j++;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return [s.slice(i + 1, j), j + 1];
  }
  return null;
}

/** Reads n brace groups after position i, skipping whitespace and `[..]` options. */
function readArgs(s: string, i: number, n: number): { args: string[]; end: number } | null {
  const args: string[] = [];
  for (let k = 0; k < n; k++) {
    while (/\s/.test(s[i] ?? '') || s[i] === '[') {
      i = s[i] === '[' ? s.indexOf(']', i) + 1 || s.length : i + 1;
    }
    const g = readGroup(s, i);
    if (!g) return null;
    args.push(g[0]);
    i = g[1];
  }
  return { args, end: i };
}

/** Rows of raw cells: `\\` and `&` split only at brace depth 0 and never when escaped. */
function splitBody(body: string): string[][] {
  const rows: string[][] = [[]];
  let depth = 0;
  let start = 0;
  const opt = /\s*\[[^[\]]*\]/y;
  const cut = (end: number) => rows[rows.length - 1]?.push(body.slice(start, end));
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === '\\') {
      if (body[i + 1] === '\\' && depth === 0) {
        cut(i);
        rows.push([]);
        i++;
        opt.lastIndex = i + 1;
        if (opt.test(body)) i = opt.lastIndex - 1;
        start = i + 1;
      } else i++;
    } else if (ch === '{') depth++;
    else if (ch === '}') depth--;
    else if (ch === '&' && depth === 0) {
      cut(i);
      start = i + 1;
    }
  }
  cut(body.length);
  return rows;
}

const RULES =
  /\\(?:toprule|midrule|bottomrule|hline)\b|\\cline\{[^{}]*\}|\\cmidrule(?:\([^()]*\))?\{[^{}]*\}/g;

// Capped: spans come from document text and size the grid.
const span = (n = '') => Math.min(100, Math.max(1, Number.parseInt(n, 10) || 1));

function parseCell(raw: string): { cell: Cell; letter: Align | null } {
  let s = raw.replace(RULES, '').trim();
  let colspan = 1;
  let rowspan = 1;
  let letter: Align | null = null;
  const mc = s.startsWith('\\multicolumn') ? readArgs(s, 12, 3) : null;
  if (mc) {
    colspan = span(mc.args[0]);
    letter = /[lcr]/.exec(mc.args[1] ?? '')?.[0] as Align | null;
    s = (mc.args[2] ?? '').trim();
  }
  const mr = s.startsWith('\\multirow') ? readArgs(s, 9, 3) : null;
  if (mr) {
    rowspan = span(mr.args[0]);
    s = (mr.args[2] ?? '').trim();
  }
  return { cell: mk(s, colspan, rowspan), letter };
}

function argOf(s: string, cmd: string): string {
  const m = new RegExp(String.raw`\\${cmd}(?![a-zA-Z])`).exec(s);
  return (m && readArgs(s, m.index + m[0].length, 1)?.args[0]) || '';
}

export function parseLatex(
  src: string,
): { table: TableModel; options: Partial<TableOptions> } | null {
  const begin = src.indexOf('\\begin{tabular}');
  if (begin < 0) return null;
  const specArg = readArgs(src, begin + '\\begin{tabular}'.length, 1);
  const end = src.indexOf('\\end{tabular}', specArg?.end ?? begin);
  if (!specArg || end < 0) return null;
  const spec = specArg.args[0] ?? '';
  // ponytail: comments inside an edited table are dropped.
  const body = src.slice(specArg.end, end).replace(/(^|[^\\])%.*$/gm, '$1');

  // ponytail: p/m/b/X become 'l'; @{} >{} <{} are skipped and *{n}{..} is ignored.
  const align: Align[] = [];
  for (let i = 0; i < spec.length; i++) {
    const ch = spec[i] ?? '';
    if ('lcr'.includes(ch)) align.push(ch as Align);
    else if ('pmb'.includes(ch) || ch === 'X') {
      align.push('l');
      if (ch !== 'X') i = (readGroup(spec, i + 1)?.[1] ?? i + 1) - 1;
    } else if ('@<>!'.includes(ch)) i = (readGroup(spec, i + 1)?.[1] ?? i + 1) - 1;
  }

  const raw = splitBody(body);
  const header = /^\s*\\(?:midrule|hline)\b/.test(raw[1]?.[0] ?? '');
  const isBlank = (r: string[]) => r.every((c) => !c.replace(RULES, '').trim());
  if (raw.length > 1 && isBlank(raw[raw.length - 1] ?? [])) raw.pop();

  // Place cells; rows below a multirow carry empty cells at the covered columns.
  const taken = new Set<string>();
  const placed: { c: number; cell: Cell }[][] = [];
  let width = align.length;
  raw.forEach((cells, r) => {
    const row: { c: number; cell: Cell }[] = [];
    let c = 0;
    for (const text of cells) {
      const parsed = parseCell(text);
      let cell = parsed.cell;
      if (!taken.has(`${r},${c}`)) {
        if (parsed.letter && c === align.length) align.push(parsed.letter);
        const keys: string[] = [];
        const rs = Math.min(cell.rowspan ?? 1, raw.length - r);
        for (let i = 0; i < rs; i++) {
          for (let j = 0; j < (cell.colspan ?? 1); j++) if (i || j) keys.push(`${r + i},${c + j}`);
        }
        // Overlapping spans stay a plain cell.
        if (keys.some((k) => taken.has(k))) cell = mk(cell.text);
        else for (const k of keys) taken.add(k);
        row.push({ c, cell });
      }
      c += cell.colspan ?? 1;
    }
    width = Math.max(width, c);
    placed.push(row);
  });

  while (align.length < width) align.push('c');
  const rows = placed.map((row, r) => {
    const out = Array.from({ length: width }, () => mk(''));
    for (const { c, cell } of row) {
      if (c < width)
        out[c] = mk(
          cell.text,
          Math.min(cell.colspan ?? 1, width - c),
          Math.min(cell.rowspan ?? 1, placed.length - r),
        );
    }
    return out;
  });

  const outside = src.slice(0, begin) + src.slice(end);
  const float = src.includes('\\begin{table');
  const options: Partial<TableOptions> = {
    style: spec.includes('|')
      ? 'grid'
      : /\\(?:top|mid|bottom)rule/.test(body)
        ? 'booktabs'
        : /\\hline/.test(body)
          ? 'lines'
          : 'plain',
    header,
    float,
    escape: false,
    caption: argOf(outside, 'caption'),
    label: argOf(outside, 'label'),
    source: argOf(outside, 'fonte'),
    position: float ? (/\\begin\{table\*?\}\s*\[([^[\]]*)\]/.exec(src)?.[1] ?? '') : '',
  };
  return { table: { rows, align }, options };
}

export function parseTsv(text: string): string[][] {
  const lines = text.replace(/\r/g, '').split('\n');
  // ponytail: quoted multi-line cells are not supported.
  if (lines[lines.length - 1] === '') lines.pop();
  return lines.map((l) => l.split('\t'));
}

export function pasteGrid(t: TableModel, row: number, col: number, grid: string[][]): TableModel {
  const rows = Math.max(t.rows.length, row + grid.length);
  const cols = Math.max(t.align.length, col + Math.max(0, ...grid.map((g) => g.length)));
  const out = t.rows.map((r) => [...r, ...Array.from({ length: cols - r.length }, () => mk(''))]);
  while (out.length < rows) out.push(Array.from({ length: cols }, () => mk('')));
  const cov = coveredBy({ rows: out, align: t.align });
  grid.forEach((line, i) => {
    line.forEach((text, j) => {
      const target = out[row + i];
      const cell = target?.[col + j];
      if (target && cell && !cov[row + i]?.[col + j]) target[col + j] = { ...cell, text };
    });
  });
  return {
    rows: out,
    align: [...t.align, ...Array.from({ length: cols - t.align.length }, () => 'c' as const)],
  };
}

export function merge(
  t: TableModel,
  r0: number,
  c0: number,
  r1: number,
  c1: number,
): TableModel | null {
  const [ra, rb] = [Math.min(r0, r1), Math.max(r0, r1)];
  const [ca, cb] = [Math.min(c0, c1), Math.max(c0, c1)];
  if (ra === rb && ca === cb) return null;
  const cov = coveredBy(t);
  const texts: string[] = [];
  for (let r = ra; r <= rb; r++) {
    for (let c = ca; c <= cb; c++) {
      const o = cov[r]?.[c];
      const cell = t.rows[r]?.[c];
      if (!cell) return null;
      // A span may not stick out of the rectangle, nor start outside of it.
      if (o && (o[0] < ra || o[1] < ca)) return null;
      if (r + (cell.rowspan ?? 1) - 1 > rb || c + (cell.colspan ?? 1) - 1 > cb) return null;
      if (!o && cell.text) texts.push(cell.text);
    }
  }
  const rows = t.rows.map((row, r) =>
    row.map((cell, c) => {
      if (r < ra || r > rb || c < ca || c > cb) return cell;
      return r === ra && c === ca ? mk(texts.join(' '), cb - ca + 1, rb - ra + 1) : mk('');
    }),
  );
  return { ...t, rows };
}

export function split(t: TableModel, row: number, col: number): TableModel {
  return mapSpans(t, (r, c) => r === row && c === col, 'both');
}

/** Replaces every span origin accepted by `hit`, dropping the given dimension of the span. */
function mapSpans(
  t: TableModel,
  hit: (r: number, c: number, cell: Cell) => boolean,
  drop: 'row' | 'col' | 'both',
): TableModel {
  const rows = t.rows.map((row, r) =>
    row.map((cell, c) => {
      if (!hit(r, c, cell)) return cell;
      return mk(cell.text, drop === 'row' ? cell.colspan : 1, drop === 'col' ? cell.rowspan : 1);
    }),
  );
  return { ...t, rows };
}

export function insertRow(t: TableModel, at: number): TableModel {
  const s = mapSpans(t, (r, _c, cell) => r < at && at < r + (cell.rowspan ?? 1), 'row');
  const rows = [...s.rows];
  rows.splice(
    at,
    0,
    t.align.map(() => mk('')),
  );
  return { ...s, rows };
}

export function insertCol(t: TableModel, at: number): TableModel {
  const s = mapSpans(t, (_r, c, cell) => c < at && at < c + (cell.colspan ?? 1), 'col');
  const rows = s.rows.map((row) => [...row.slice(0, at), mk(''), ...row.slice(at)]);
  const align = [...t.align];
  align.splice(at, 0, t.align[Math.min(at, t.align.length - 1)] ?? 'c');
  return { rows, align };
}

export function deleteRow(t: TableModel, at: number): TableModel {
  if (t.rows.length < 2) return t;
  const rows = t.rows.map((row) => [...row]);
  t.rows.forEach((row, r) => {
    row.forEach((cell, c) => {
      const rs = cell.rowspan ?? 1;
      if (r > at || r + rs <= at || rs < 2) return;
      // Shrink the span; when its origin row goes away the origin moves down.
      const moved = mk(cell.text, cell.colspan, rs - 1);
      const target = rows[r < at ? r : at + 1];
      if (target) target[c] = moved;
    });
  });
  rows.splice(at, 1);
  return { ...t, rows };
}

export function deleteCol(t: TableModel, at: number): TableModel {
  if (t.align.length < 2) return t;
  const rows = t.rows.map((row) => [...row]);
  t.rows.forEach((row, r) => {
    row.forEach((cell, c) => {
      const cs = cell.colspan ?? 1;
      if (c > at || c + cs <= at || cs < 2) return;
      const moved = mk(cell.text, cs - 1, cell.rowspan);
      const target = rows[r];
      if (target) target[c < at ? c : at + 1] = moved;
    });
  });
  return {
    rows: rows.map((row) => row.filter((_, c) => c !== at)),
    align: t.align.filter((_, c) => c !== at),
  };
}
