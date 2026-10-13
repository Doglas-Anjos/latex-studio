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
// centre, its chapters as hubs around it, each ringed by the terms that characterise it. Laid out
// once with d3-force and fit to the view; wheel zooms toward the cursor, drag pans, and a click on
// a chapter or term jumps to it in the text. ponytail: static layout (nodes can't be dragged).
type SimNode = SubjectNode & SimulationNodeDatum;
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
// Paint order: terms, then chapters, then the document on top.
const LAYER = { term: 0, hub: 1, root: 2 } as const;

function layout(nodes: SimNode[], links: SimLink[]) {
  forceSimulation(nodes)
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
    .tick(400);
}

export function GraphView({ projectId }: { projectId: string }) {
  const refs = useService(ReferenceServiceToken);
  const topics = useQuery({
    queryKey: ['references', projectId, 'topics'],
    queryFn: () => refs.topics(projectId),
    staleTime: 30_000,
  });

  const graph = useMemo(() => {
    if (!topics.data || topics.data.nodes.length === 0) return null;
    const nodes: SimNode[] = topics.data.nodes
      .map((n) => ({ ...n }))
      .sort((a, b) => LAYER[a.kind] - LAYER[b.kind]);
    const links: SimLink[] = topics.data.links.map((l) => ({ ...l }));
    layout(nodes, links);
    const xs = nodes.map((n) => n.x ?? 0);
    const ys = nodes.map((n) => n.y ?? 0);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const at = (n: SimNode) => ({ x: (n.x ?? 0) - minX + PAD, y: (n.y ?? 0) - minY + PAD });
    const width = Math.max(...xs) - minX + PAD * 2;
    const height = Math.max(...ys) - minY + PAD * 2;
    return { nodes, links, width, height, at };
  }, [topics.data]);

  // The whole graph fits the view via the viewBox; wheel zoom and drag pan move the viewBox.
  const svgRef = useRef<SVGSVGElement>(null);
  const [vb, setVb] = useState<Box | null>(null);
  // A press becomes a pan only past a few pixels, so a plain click still reaches a node.
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset the viewport when a new graph lays out.
  useEffect(() => setVb(graph ? { x: 0, y: 0, w: graph.width, h: graph.height } : null), [graph]);

  if (topics.isPending) return <p className="status-note">Analisando o texto…</p>;
  if (topics.error) return <p className="form-error">Erro ao ler o documento.</p>;
  if (!graph) return <p className="nav-empty">Nenhum assunto encontrado (texto curto demais).</p>;

  const box: Box = vb ?? { x: 0, y: 0, w: graph.width, h: graph.height };
  const onWheel = (e: WheelEvent) => {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r) return;
    const mx = box.x + ((e.clientX - r.left) / r.width) * box.w;
    const my = box.y + ((e.clientY - r.top) / r.height) * box.h;
    const f = e.deltaY < 0 ? 0.85 : 1 / 0.85;
    const w = Math.min(Math.max(box.w * f, graph.width * 0.15), graph.width * 1.5);
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
