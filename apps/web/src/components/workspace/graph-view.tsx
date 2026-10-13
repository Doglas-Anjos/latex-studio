import { useQuery } from '@tanstack/react-query';
import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force';
import { FileText, Maximize2, Minus, Plus, RotateCcw, X } from 'lucide-react';
import {
  type KeyboardEvent,
  type PointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
  type WheelEvent,
} from 'react';
import { useService } from '../../di/service-provider';
import { ReferenceServiceToken, type SubjectNode } from '../../services/reference.service';
import { useWorkspaceStore } from '../../workspace-store';

// The "Grafo de assuntos", in the spirit of the Neo4j browser: the document in the middle, its
// areas of interest around it (one colour per area), each ringed by its more specific terms.
// Physics stays live: drag a node and it pins where you drop it; hover lights up its neighbours;
// a click opens its details (and a jump to the text); the legend focuses an area. It follows the
// document — refetched after edits, relaid out from the previous positions so it grows in place.
type SimNode = SubjectNode & SimulationNodeDatum;
type Point = { x: number; y: number };
// d3 replaces `source`/`target` (the ids) with the node objects once the simulation runs.
interface SimLink extends SimulationLinkDatum<SimNode> {
  weight: number;
}
/** A region in SVG user space (the viewBox). */
interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

// One colour per area, Neo4j-style; the document and its overall terms in neutral grey.
const PALETTE = [
  '#f79767',
  '#57c7e3',
  '#8dcc93',
  '#c990c0',
  '#f16667',
  '#ffc454',
  '#4c8eda',
  '#da7194',
  '#569480',
  '#d9c8ae',
  '#ecb5c9',
  '#b5a2e0',
];
const NEUTRAL = '#a5abb6';
const PAD = 70;
// Paint order: terms, then areas, then the document on top.
const LAYER = { term: 0, hub: 1, root: 2 } as const;
const KIND = { root: 'Documento', hub: 'Área', term: 'Termo' } as const;

const asNode = (end: SimLink['source']) => end as SimNode;
/** Document → area: the long edges of the map. */
const spine = (l: SimLink) => asNode(l.source).kind === 'root' && asNode(l.target).kind === 'hub';
/** A node's identity across refetches: its label, so a term promoted to an area keeps its place. */
const keyOf = (n: SubjectNode) => (n.kind === 'root' ? 'root' : n.label);
const radius = (n: SubjectNode) =>
  n.kind === 'root' ? 44 : n.kind === 'hub' ? 34 : 23 + Math.min(8, Math.sqrt(n.count));
const fontSize = (n: SubjectNode) => (n.kind === 'root' ? 13 : n.kind === 'hub' ? 11 : 10);

/** `hex` darkened by `f` (0-1), for a node's outline. */
const shade = (hex: string, f: number) =>
  `#${[1, 3, 5]
    .map((i) =>
      Math.round(Number.parseInt(hex.slice(i, i + 2), 16) * (1 - f))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
/** Dark or white text, whichever reads on `hex`. */
const inkOn = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255) as [
    number,
    number,
    number,
  ];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.45 ? '#1d1f23' : '#ffffff';
};

const MIN_FONT = 7;
/** Characters of a `size`px caption that fit across a circle of radius `r`. */
const fits = (r: number, size: number) => Math.max(3, Math.floor((r * 1.7) / (size * 0.58)));

/**
 * The caption inside a node: whole words on up to two lines (split at spaces and hyphens), the
 * font shrunk from `base` toward MIN_FONT until they fit; only past that is the text cut with "…".
 */
export function caption(label: string, r: number, base: number): { lines: string[]; size: number } {
  const words = label.split(/(?<=-)|\s+/).filter(Boolean);
  const wrap = (max: number) => {
    const lines: string[] = [];
    let cur = '';
    for (const w of words) {
      const next = cur ? (cur.endsWith('-') ? cur + w : `${cur} ${w}`) : w;
      if (next.length <= max || !cur) cur = next;
      else {
        lines.push(cur);
        cur = w;
      }
    }
    return cur ? [...lines, cur] : lines;
  };
  for (let size = base; size >= MIN_FONT; size -= 0.5) {
    const lines = wrap(fits(r, size));
    if (lines.length <= 2 && lines.every((l) => l.length <= fits(r, size))) return { lines, size };
  }
  const max = fits(r, MIN_FONT);
  const lines = wrap(max);
  const cut = (l: string) => (l.length > max ? `${l.slice(0, max - 1)}…` : l);
  const out = lines.slice(0, 2).map(cut);
  if (lines.length > 2) out[1] = `${(out[1] as string).slice(0, max - 1)}…`;
  return { lines: out, size: MIN_FONT };
}

/**
 * Starts nodes where they were last time; a new node starts next to a placed neighbour (its area,
 * for a term), so it settles in beside it. Returns whether there was a previous layout to keep.
 */
export function seedPositions(
  nodes: SimNode[],
  links: { source: string; target: string }[],
  prev: Map<string, Point>,
): boolean {
  if (prev.size === 0) return false;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const neighbours = (id: string) =>
    links.flatMap((l) => (l.target === id ? [l.source] : l.source === id ? [l.target] : []));
  const placed = (n: SimNode | undefined) => n?.x !== undefined && n.y !== undefined;
  for (const n of nodes) {
    const p = prev.get(keyOf(n));
    if (p) Object.assign(n, p);
  }
  // Root, then areas, then terms, so a new area's new terms find it already placed.
  const order = [...nodes].sort((a, b) => LAYER[b.kind] - LAYER[a.kind]);
  order.forEach((n, i) => {
    if (placed(n)) return;
    const near = neighbours(n.id)
      .map((id) => byId.get(id))
      .find(placed);
    const angle = i * 2.39996; // golden angle: siblings fan out instead of stacking
    n.x = (near?.x ?? 0) + 40 * Math.cos(angle);
    n.y = (near?.y ?? 0) + 40 * Math.sin(angle);
  });
  return true;
}

function simulate(nodes: SimNode[], links: SimLink[]) {
  return forceSimulation(nodes)
    .force(
      'link',
      forceLink<SimNode, SimLink>(links)
        .id((d) => d.id)
        // Areas sit well away from the document; terms hug their area.
        .distance((l) => (spine(l) ? 250 : 100))
        .strength((l) => (spine(l) ? 0.25 : 0.8)),
    )
    .force(
      'charge',
      forceManyBody<SimNode>().strength((d) => (d.kind === 'term' ? -260 : -1400)),
    )
    .force('x', forceX(0).strength(0.04))
    .force('y', forceY(0).strength(0.04))
    .force(
      'collide',
      forceCollide<SimNode>().radius((d) => radius(d) + 8),
    )
    .stop();
}

/** The box framing `nodes`, with room for their circles. */
const frame = (nodes: SimNode[]): Box => {
  const xs = nodes.map((n) => n.x ?? 0);
  const ys = nodes.map((n) => n.y ?? 0);
  const x = Math.min(...xs) - PAD;
  const y = Math.min(...ys) - PAD;
  return { x, y, w: Math.max(...xs) + PAD - x, h: Math.max(...ys) + PAD - y };
};

export function GraphView({ projectId }: { projectId: string }) {
  const refs = useService(ReferenceServiceToken);
  const topics = useQuery({
    queryKey: ['references', projectId, 'topics'],
    queryFn: () => refs.topics(projectId),
    staleTime: 30_000,
    // Collaborators' edits don't bump docVersion: pick them up while the view is open. An
    // unchanged answer keeps the same `data` (structural sharing), so nothing is laid out again.
    refetchInterval: 30_000,
  });
  // Own edits: refetch once typing pauses, after the server's debounced save (2 s) has landed.
  // Subscribed outside React state so a keystroke doesn't re-render the graph.
  const { refetch } = topics;
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = useWorkspaceStore.subscribe((s, prev) => {
      if (s.docVersion === prev.docVersion) return;
      clearTimeout(timer);
      timer = setTimeout(() => void refetch(), 5000);
    });
    return () => {
      stop();
      clearTimeout(timer);
    };
  }, [refetch]);

  // Survive refetches: last positions, nodes the user pinned by dragging, and each area's colour.
  const positions = useRef(new Map<string, Point>());
  const pinned = useRef(new Map<string, Point>());
  const colours = useRef(new Map<string, string>());

  const model = useMemo(() => {
    if (!topics.data || topics.data.nodes.length === 0) return null;
    const nodes: SimNode[] = topics.data.nodes
      .map((n) => ({ ...n }))
      .sort((a, b) => LAYER[a.kind] - LAYER[b.kind]);
    const warm = seedPositions(nodes, topics.data.links, positions.current);
    for (const n of nodes) {
      const p = pinned.current.get(keyOf(n));
      if (p) Object.assign(n, { x: p.x, y: p.y, fx: p.x, fy: p.y });
    }
    const links: SimLink[] = topics.data.links.map((l) => ({ ...l }));
    const sim = simulate(nodes, links).alpha(warm ? 0.3 : 1);
    sim.tick(warm ? 100 : 300);
    positions.current = new Map(nodes.map((n) => [keyOf(n), { x: n.x ?? 0, y: n.y ?? 0 }]));

    // A term's area is the hub linking to it; an area is its own; the document's terms have none.
    const areaOf = new Map<string, string>();
    const neighbours = new Map<string, string[]>(nodes.map((n) => [n.id, []]));
    for (const l of topics.data.links) {
      if (l.source.startsWith('h:')) areaOf.set(l.target, l.source);
      neighbours.get(l.source)?.push(l.target);
      neighbours.get(l.target)?.push(l.source);
    }
    const hubs = nodes.filter((n) => n.kind === 'hub');
    for (const h of hubs) areaOf.set(h.id, h.id);
    // Colours stick to an area across refetches; a new area takes the first free one.
    const used = new Set(hubs.map((h) => colours.current.get(h.label)).filter(Boolean));
    for (const h of hubs)
      if (!colours.current.has(h.label)) {
        const free = PALETTE.find((c) => !used.has(c)) ?? NEUTRAL;
        colours.current.set(h.label, free);
        used.add(free);
      }
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const colour = (n: SimNode) => {
      const area = byId.get(areaOf.get(n.id) ?? '');
      return (area && colours.current.get(area.label)) ?? NEUTRAL;
    };
    return { nodes, links, sim, hubs, byId, areaOf, neighbours, colour };
  }, [topics.data]);

  // Live physics: re-render on each tick (a drag reheats it); remember positions when it settles.
  const [, setFrame] = useState(0);
  useEffect(() => {
    if (!model) return;
    model.sim.on('tick', () => setFrame((f) => f + 1));
    model.sim.on('end', () => {
      positions.current = new Map(model.nodes.map((n) => [keyOf(n), { x: n.x ?? 0, y: n.y ?? 0 }]));
    });
    return () => {
      model.sim.on('tick', null).on('end', null).stop();
    };
  }, [model]);

  const svgRef = useRef<SVGSVGElement>(null);
  // Fit to the graph until the user zooms, pans or drags; then keep their view.
  const [vb, setVb] = useState<Box | null>(null);
  const touched = useRef(false);
  const press = useRef<{ x: number; y: number; moved: boolean; node: SimNode | null } | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [hoverArea, setHoverArea] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  if (topics.isPending) return <p className="status-note">Analisando o texto…</p>;
  if (topics.error) return <p className="form-error">Erro ao ler o documento.</p>;
  if (!model) return <p className="nav-empty">Nenhum assunto encontrado (texto curto demais).</p>;

  const fit = frame(model.nodes);
  const box = touched.current && vb ? vb : fit;
  const sel = selected ? model.byId.get(selected) : undefined;

  // Hover a node → it and its neighbours; hover an area in the legend → that area; else selection.
  const focus = hover
    ? new Set([hover, ...(model.neighbours.get(hover) ?? [])])
    : hoverArea
      ? new Set(model.nodes.filter((n) => model.areaOf.get(n.id) === hoverArea).map((n) => n.id))
      : selected
        ? new Set([selected, ...(model.neighbours.get(selected) ?? [])])
        : null;

  /** Client coordinates → SVG user space. */
  const toUser = (x: number, y: number): Point => {
    const svg = svgRef.current;
    const m = svg?.getScreenCTM()?.inverse();
    if (!svg || !m) return { x: 0, y: 0 };
    const p = new DOMPoint(x, y).matrixTransform(m);
    return { x: p.x, y: p.y };
  };
  const zoom = (f: number, at: Point = { x: box.x + box.w / 2, y: box.y + box.h / 2 }) => {
    touched.current = true;
    const w = Math.min(Math.max(box.w * f, fit.w * 0.1), fit.w * 3);
    const h = w * (box.h / box.w);
    setVb({ x: at.x - (at.x - box.x) * (w / box.w), y: at.y - (at.y - box.y) * (h / box.h), w, h });
  };
  const refit = () => {
    touched.current = false;
    setVb(null);
  };
  const focusArea = (hubId: string) => {
    touched.current = true;
    setVb(frame(model.nodes.filter((n) => model.areaOf.get(n.id) === hubId)));
    setSelected(hubId);
  };
  const reorganize = () => {
    pinned.current.clear();
    for (const n of model.nodes) {
      n.fx = null;
      n.fy = null;
    }
    refit();
    model.sim.alpha(0.8).restart();
  };
  const jump = (n: SimNode) => n.path && useWorkspaceStore.getState().goToLine(n.path, n.line ?? 1);

  const onWheel = (e: WheelEvent) =>
    zoom(e.deltaY < 0 ? 0.85 : 1 / 0.85, toUser(e.clientX, e.clientY));
  const onDown = (e: PointerEvent, node: SimNode | null = null) => {
    if (node) e.stopPropagation(); // a node press drags the node, not the view
    press.current = { x: e.clientX, y: e.clientY, moved: false, node };
  };
  const onMove = (e: PointerEvent) => {
    const p = press.current;
    if (!p) return;
    if (!p.moved) {
      if (Math.hypot(e.clientX - p.x, e.clientY - p.y) < 4) return;
      p.moved = true;
      touched.current = true;
      // Captured from here on: the release lands on the svg, so a drag never counts as a click.
      e.currentTarget.setPointerCapture(e.pointerId);
      // Reheat at once (not just aim at 0.3), so even a quick drag leaves the neighbours a few
      // seconds of physics to follow it.
      if (p.node) model.sim.alpha(Math.max(model.sim.alpha(), 0.3)).alphaTarget(0.3).restart();
    }
    if (p.node) {
      const u = toUser(e.clientX, e.clientY);
      p.node.fx = u.x;
      p.node.fy = u.y;
    } else {
      const a = toUser(p.x, p.y);
      const b = toUser(e.clientX, e.clientY);
      setVb({ ...box, x: box.x - (b.x - a.x), y: box.y - (b.y - a.y) });
    }
    p.x = e.clientX;
    p.y = e.clientY;
  };
  const onUp = () => {
    const p = press.current;
    press.current = null;
    if (!p) return;
    if (p.node && p.moved) {
      // Dropped: it stays pinned there, and the rest settles around it.
      model.sim.alphaTarget(0);
      pinned.current.set(keyOf(p.node), { x: p.node.fx ?? 0, y: p.node.fy ?? 0 });
    } else if (p.node) setSelected(p.node.id);
    else if (!p.moved) setSelected(null);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') setSelected(null);
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Escape clears the selection; the controls inside are the interactive elements.
    <div className="graph-view" onKeyDown={onKey}>
      <svg
        ref={svgRef}
        width="100%"
        height="100%"
        viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}
        preserveAspectRatio="xMidYMid meet"
        aria-label="Grafo de assuntos"
        onWheel={onWheel}
        onPointerDown={(e) => onDown(e)}
        onPointerMove={onMove}
        onPointerUp={onUp}
      >
        <defs>
          <marker
            id="graph-arrow"
            className="graph-arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M0,1 L9,5 L0,9 z" />
          </marker>
        </defs>
        {model.links.map((l) => {
          const s = asNode(l.source);
          const t = asNode(l.target);
          const dx = (t.x ?? 0) - (s.x ?? 0);
          const dy = (t.y ?? 0) - (s.y ?? 0);
          const d = Math.hypot(dx, dy) || 1;
          // From circle edge to circle edge, so the arrowhead touches the target.
          const [x1, y1] = [(s.x ?? 0) + (dx / d) * radius(s), (s.y ?? 0) + (dy / d) * radius(s)];
          const [x2, y2] = [
            (t.x ?? 0) - (dx / d) * (radius(t) + 2),
            (t.y ?? 0) - (dy / d) * (radius(t) + 2),
          ];
          const dim = focus && !(focus.has(s.id) && focus.has(t.id));
          return (
            <line
              key={`${s.id}>${t.id}`}
              className="graph-edge"
              data-spine={spine(l) || undefined}
              data-dim={dim || undefined}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              markerEnd="url(#graph-arrow)"
            />
          );
        })}
        {model.nodes.map((n) => {
          const r = radius(n);
          const fill = model.colour(n);
          const { lines, size } = caption(n.label, r, fontSize(n));
          return (
            // biome-ignore lint/a11y/noStaticElementInteractions: SVG has no interactive element; a focusable <g> with pointer + key handlers is the accessible option.
            <g
              key={n.id}
              className="graph-node"
              data-kind={n.kind}
              data-dim={(focus && !focus.has(n.id)) || undefined}
              data-pinned={n.fx != null || undefined}
              transform={`translate(${n.x ?? 0},${n.y ?? 0})`}
              tabIndex={0}
              aria-label={`${KIND[n.kind]}: ${n.label}`}
              onPointerDown={(e) => onDown(e, n)}
              onPointerEnter={() => setHover(n.id)}
              onPointerLeave={() => setHover(null)}
              onDoubleClick={() => jump(n)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') setSelected(n.id);
              }}
            >
              <title>{n.kind === 'term' ? `${n.label} · em ${n.count} parágrafos` : n.label}</title>
              {selected === n.id && <circle className="graph-halo" r={r + 7} />}
              <circle r={r} fill={fill} stroke={shade(fill, 0.25)} />
              <text fill={inkOn(fill)} fontSize={size} textAnchor="middle">
                {lines.map((l, i) => (
                  <tspan
                    // biome-ignore lint/suspicious/noArrayIndexKey: a caption's lines are positional (line 1, line 2).
                    key={i}
                    x={0}
                    y={(i - (lines.length - 1) / 2) * size * 1.15 + size * 0.35}
                  >
                    {l}
                  </tspan>
                ))}
              </text>
            </g>
          );
        })}
      </svg>

      <ul className="graph-legend" aria-label="Áreas">
        {model.hubs.map((h) => (
          <li key={h.id}>
            <button
              type="button"
              onPointerEnter={() => setHoverArea(h.id)}
              onPointerLeave={() => setHoverArea(null)}
              onClick={() => focusArea(h.id)}
              title="Focar esta área"
            >
              <span className="graph-dot" style={{ background: model.colour(h) }} />
              {h.label}
            </button>
          </li>
        ))}
      </ul>

      <div className="graph-controls">
        <button type="button" aria-label="Aproximar" title="Aproximar" onClick={() => zoom(0.8)}>
          <Plus size={15} aria-hidden="true" />
        </button>
        <button type="button" aria-label="Afastar" title="Afastar" onClick={() => zoom(1.25)}>
          <Minus size={15} aria-hidden="true" />
        </button>
        <button type="button" aria-label="Ajustar à tela" title="Ajustar à tela" onClick={refit}>
          <Maximize2 size={15} aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label="Reorganizar"
          title="Reorganizar (solta os nós fixados)"
          onClick={reorganize}
        >
          <RotateCcw size={15} aria-hidden="true" />
        </button>
      </div>

      {sel && (
        <section className="graph-inspector" aria-label="Detalhes">
          <header>
            <span className="graph-dot" style={{ background: model.colour(sel) }} />
            <strong>{sel.label}</strong>
            <button type="button" aria-label="Fechar" onClick={() => setSelected(null)}>
              <X size={14} aria-hidden="true" />
            </button>
          </header>
          <p className="graph-meta">
            {KIND[sel.kind]}
            {sel.kind !== 'root' && ` · em ${sel.count} parágrafos`}
            {sel.kind === 'term' && model.areaOf.has(sel.id) && (
              <>
                {' · área '}
                <button
                  type="button"
                  className="graph-link"
                  onClick={() => setSelected(model.areaOf.get(sel.id) ?? null)}
                >
                  {model.byId.get(model.areaOf.get(sel.id) ?? '')?.label}
                </button>
              </>
            )}
          </p>
          <div className="graph-chips">
            {(model.neighbours.get(sel.id) ?? []).map((id) => {
              const nb = model.byId.get(id);
              return (
                nb && (
                  <button
                    key={id}
                    type="button"
                    className="graph-chip"
                    onClick={() => setSelected(id)}
                  >
                    <span className="graph-dot" style={{ background: model.colour(nb) }} />
                    {nb.label}
                  </button>
                )
              );
            })}
          </div>
          {sel.path && (
            <button type="button" className="graph-jump" onClick={() => jump(sel)}>
              <FileText size={14} aria-hidden="true" /> Ir para o texto
            </button>
          )}
        </section>
      )}
    </div>
  );
}
