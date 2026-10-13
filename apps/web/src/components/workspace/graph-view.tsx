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
import { type PointerEvent, useEffect, useMemo, useRef, useState, type WheelEvent } from 'react';
import { useService } from '../../di/service-provider';
import { ReferenceServiceToken, type SubjectNode } from '../../services/reference.service';
import { useWorkspaceStore } from '../../workspace-store';

// The "Grafo de assuntos": the document as a big picture to drill into — the document at the
// centre, its areas of interest as hubs around it, each ringed by its more specific terms. Laid out
// with d3-force and fit to the view; wheel zooms toward the cursor, drag pans, and a click on an
// area or term jumps to it in the text. It follows the document: refetched after edits, and each
// relayout starts from the previous positions so the map grows in place instead of reshuffling.
// ponytail: nodes can't be dragged.
type SimNode = SubjectNode & SimulationNodeDatum;
type Point = { x: number; y: number };
// d3 replaces `source`/`target` (the ids) with the node objects once the simulation runs.
interface SimLink extends SimulationLinkDatum<SimNode> {
  weight: number;
}
/** The visible region in user space (SVG viewBox); panned and zoomed by the user. */
interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
const PAD = 60;
const asNode = (end: SimLink['source']) => end as SimNode;
/** Document → chapter: the long edges of the map (the document's own terms hug it like any hub's). */
const spine = (l: SimLink) => asNode(l.source).kind === 'root' && asNode(l.target).kind === 'hub';
const radius = (n: SubjectNode) =>
  n.kind === 'root'
    ? 30
    : n.kind === 'hub'
      ? 21
      : Math.max(5, Math.min(12, 4 + Math.sqrt(n.count)));
const maxLabel = (n: SubjectNode) => (n.kind === 'term' ? 18 : 26);
const short = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);
// Paint order: terms, then areas, then the document on top.
const LAYER = { term: 0, hub: 1, root: 2 } as const;
/** A node's identity across refetches: its label, so a term promoted to an area keeps its place. */
const keyOf = (n: SubjectNode) => (n.kind === 'root' ? 'root' : n.label);

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
  // Parent first: a link's source is the root or an area, its target what hangs from it.
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

function layout(nodes: SimNode[], links: SimLink[], warm: boolean) {
  forceSimulation(nodes)
    // A warm start only lets things settle around the newcomers instead of laying out anew.
    .alpha(warm ? 0.3 : 1)
    .force(
      'link',
      forceLink<SimNode, SimLink>(links)
        .id((d) => d.id)
        // Chapters sit well away from the centre; terms hug their chapter.
        .distance((l) => (spine(l) ? 200 : 58))
        .strength((l) => (spine(l) ? 0.3 : 0.9)),
    )
    .force(
      'charge',
      forceManyBody<SimNode>().strength((d) => (d.kind === 'term' ? -80 : -900)),
    )
    .force('x', forceX(0).strength(0.05))
    .force('y', forceY(0).strength(0.05))
    .force(
      'collide',
      // Room for the label under each node, so neighbours' labels don't overlap.
      forceCollide<SimNode>().radius(
        (d) => radius(d) + 6 + Math.min(d.label.length, maxLabel(d)) * 1.5,
      ),
    )
    .stop()
    .tick(warm ? 150 : 400);
}

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

  // Last positions by node identity, so each relayout continues the previous one.
  const positions = useRef(new Map<string, Point>());
  const graph = useMemo(() => {
    if (!topics.data || topics.data.nodes.length === 0) return null;
    const nodes: SimNode[] = topics.data.nodes
      .map((n) => ({ ...n }))
      .sort((a, b) => LAYER[a.kind] - LAYER[b.kind]);
    const warm = seedPositions(nodes, topics.data.links, positions.current);
    const links: SimLink[] = topics.data.links.map((l) => ({ ...l }));
    layout(nodes, links, warm);
    positions.current = new Map(nodes.map((n) => [keyOf(n), { x: n.x ?? 0, y: n.y ?? 0 }]));
    const xs = nodes.map((n) => n.x ?? 0);
    const ys = nodes.map((n) => n.y ?? 0);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    // Simulation coordinates are kept as they are (stable across relayouts); this box frames them.
    const fit: Box = {
      x: minX - PAD,
      y: minY - PAD,
      w: Math.max(...xs) - minX + PAD * 2,
      h: Math.max(...ys) - minY + PAD * 2,
    };
    const at = (n: SimNode): Point => ({ x: n.x ?? 0, y: n.y ?? 0 });
    return { nodes, links, fit, at };
  }, [topics.data]);

  // The whole graph fits the view via the viewBox; wheel zoom and drag pan move the viewBox.
  const svgRef = useRef<SVGSVGElement>(null);
  const [vb, setVb] = useState<Box | null>(null);
  // Once the user has zoomed or panned, an update keeps their view; until then it refits.
  const touched = useRef(false);
  // A press becomes a pan only past a few pixels, so a plain click still reaches a node.
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  useEffect(() => {
    if (graph) setVb((v) => (v && touched.current ? v : graph.fit));
  }, [graph]);

  if (topics.isPending) return <p className="status-note">Analisando o texto…</p>;
  if (topics.error) return <p className="form-error">Erro ao ler o documento.</p>;
  if (!graph) return <p className="nav-empty">Nenhum assunto encontrado (texto curto demais).</p>;

  const box: Box = vb ?? graph.fit;
  const onWheel = (e: WheelEvent) => {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r) return;
    touched.current = true;
    const mx = box.x + ((e.clientX - r.left) / r.width) * box.w;
    const my = box.y + ((e.clientY - r.top) / r.height) * box.h;
    const f = e.deltaY < 0 ? 0.85 : 1 / 0.85;
    const w = Math.min(Math.max(box.w * f, graph.fit.w * 0.15), graph.fit.w * 1.5);
    const h = w * (box.h / box.w);
    setVb({ x: mx - (mx - box.x) * (w / box.w), y: my - (my - box.y) * (h / box.h), w, h });
  };
  const onDown = (e: PointerEvent) => {
    drag.current = { x: e.clientX, y: e.clientY, moved: false };
  };
  const onMove = (e: PointerEvent) => {
    const d = drag.current;
    const r = svgRef.current?.getBoundingClientRect();
    if (!d || !r) return;
    if (!d.moved) {
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 4) return;
      d.moved = true;
      touched.current = true;
      // Captured from here on: the release lands on the svg, so the drag doesn't click a node.
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    const dx = ((e.clientX - d.x) * box.w) / r.width;
    const dy = ((e.clientY - d.y) * box.h) / r.height;
    d.x = e.clientX;
    d.y = e.clientY;
    setVb({ ...box, x: box.x - dx, y: box.y - dy });
  };
  const end = () => {
    drag.current = null;
  };

  return (
    <div className="graph-view">
      <svg
        ref={svgRef}
        width="100%"
        height="100%"
        viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}
        preserveAspectRatio="xMidYMid meet"
        aria-label="Grafo de assuntos"
        onWheel={onWheel}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={end}
        onPointerLeave={end}
      >
        {graph.links.map((l) => {
          const s = asNode(l.source);
          const t = asNode(l.target);
          const a = graph.at(s);
          const b = graph.at(t);
          return (
            <line
              key={`${s.id}>${t.id}`}
              className="graph-edge"
              data-spine={spine(l) || undefined}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
            />
          );
        })}
        {graph.nodes.map((n) => {
          const p = graph.at(n);
          const r = radius(n);
          const { path, line } = n;
          const jump = path
            ? () => useWorkspaceStore.getState().goToLine(path, line ?? 1)
            : undefined;
          return (
            // biome-ignore lint/a11y/noStaticElementInteractions: SVG has no interactive element; a focusable <g> with onClick + key handler is the accessible option.
            <g
              key={n.id}
              className="graph-node"
              data-kind={n.kind}
              transform={`translate(${p.x},${p.y})`}
              onClick={jump}
              onKeyDown={jump && ((e) => (e.key === 'Enter' || e.key === ' ') && jump())}
              tabIndex={jump ? 0 : undefined}
            >
              <title>{n.kind === 'term' ? `${n.label} · ${n.count}×` : n.label}</title>
              <circle r={r} />
              <text y={r + (n.kind === 'term' ? 10 : 14)} textAnchor="middle">
                {short(n.label, maxLabel(n))}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
