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
import { ReferenceServiceToken } from '../../services/reference.service';

// The document's "subject graph": frequent terms as nodes (sized by frequency), linked when they
// co-occur in a paragraph. Laid out with d3-force once (run to rest), then drawn as static SVG and
// panned by scrolling. ponytail: static layout; node dragging and zoom are a future upgrade.
interface SimNode extends SimulationNodeDatum {
  id: string;
  term: string;
  count: number;
}
// d3 replaces `source`/`target` (the ids) with the node objects once the simulation runs.
interface SimLink extends SimulationLinkDatum<SimNode> {
  weight: number;
}
const PAD = 48;
/** The visible region in user space (SVG viewBox); panned and zoomed by the user. */
interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
const radius = (count: number) => Math.max(7, Math.min(24, 5 + count * 1.8));
const asNode = (end: SimLink['source']) => end as SimNode;

function layout(nodes: SimNode[], edges: { a: string; b: string; weight: number }[]): SimLink[] {
  const links: SimLink[] = edges.map((e) => ({ source: e.a, target: e.b, weight: e.weight }));
  forceSimulation(nodes)
    .force(
      'link',
      forceLink<SimNode, SimLink>(links)
        .id((d) => d.id)
        .distance(96)
        .strength(0.35),
    )
    .force('charge', forceManyBody().strength(-220))
    // Pull everything gently toward the centre so the graph stays compact (and stray nodes don't
    // fly off and shrink the rest when the whole thing is fit to the view).
    .force('x', forceX(0).strength(0.08))
    .force('y', forceY(0).strength(0.08))
    .force(
      'collide',
      // Reserve room for the label under each node so they don't overlap in dense clusters.
      forceCollide<SimNode>().radius((d) => radius(d.count) + 10 + d.term.length * 1.5),
    )
    .stop()
    .tick(320);
  return links;
}

export function GraphView({ projectId }: { projectId: string }) {
  const refs = useService(ReferenceServiceToken);
  const topics = useQuery({
    queryKey: ['references', projectId, 'topics'],
    queryFn: () => refs.topics(projectId),
    staleTime: 30_000,
  });

  const graph = useMemo(() => {
    if (!topics.data) return null;
    // Keep only terms that connect to something: an isolated node adds no structure and, flung out
    // by the charge force, just shrinks the rest of the graph.
    const linked = new Set(topics.data.edges.flatMap((e) => [e.a, e.b]));
    const nodes: SimNode[] = topics.data.nodes
      .filter((n) => linked.has(n.term))
      .map((n) => ({ id: n.term, term: n.term, count: n.count }));
    if (nodes.length === 0) return null;
    const links = layout(nodes, topics.data.edges);
    const xs = nodes.map((n) => n.x ?? 0);
    const ys = nodes.map((n) => n.y ?? 0);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const ox = -minX + PAD;
    const oy = -minY + PAD;
    const width = Math.max(...xs) - minX + PAD * 2;
    const height = Math.max(...ys) - minY + PAD * 2;
    const at = (n: SimNode) => ({ x: (n.x ?? 0) + ox, y: (n.y ?? 0) + oy });
    return { nodes, links, width, height, ox, oy, at };
  }, [topics.data]);

  // The whole graph fits the view via the viewBox; wheel zooms toward the cursor and drag pans, both
  // by moving the viewBox (user space), so nothing is ever cut off and dense clusters can be read.
  const svgRef = useRef<SVGSVGElement>(null);
  const [vb, setVb] = useState<Box | null>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset the viewport when a new graph lays out.
  useEffect(() => setVb(graph ? { x: 0, y: 0, w: graph.width, h: graph.height } : null), [graph]);

  if (topics.isPending) return <p className="status-note">Analisando o texto…</p>;
  if (topics.error) return <p className="form-error">Erro ao ler o documento.</p>;
  if (!graph || graph.nodes.length === 0)
    return <p className="nav-empty">Nenhum assunto encontrado (texto curto demais).</p>;

  const box: Box = vb ?? { x: 0, y: 0, w: graph.width, h: graph.height };
  const onWheel = (e: WheelEvent) => {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r) return;
    const mx = box.x + ((e.clientX - r.left) / r.width) * box.w;
    const my = box.y + ((e.clientY - r.top) / r.height) * box.h;
    const f = e.deltaY < 0 ? 0.85 : 1 / 0.85;
    const w = Math.min(Math.max(box.w * f, graph.width * 0.2), graph.width * 1.5);
    const h = w * (box.h / box.w);
    setVb({ x: mx - (mx - box.x) * (w / box.w), y: my - (my - box.y) * (h / box.h), w, h });
  };
  const onDown = (e: PointerEvent) => {
    drag.current = { x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = (e: PointerEvent) => {
    const r = svgRef.current?.getBoundingClientRect();
    if (!drag.current || !r) return;
    const dx = ((e.clientX - drag.current.x) * box.w) / r.width;
    const dy = ((e.clientY - drag.current.y) * box.h) / r.height;
    drag.current = { x: e.clientX, y: e.clientY };
    setVb({ ...box, x: box.x - dx, y: box.y - dy });
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
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerLeave={() => {
          drag.current = null;
        }}
      >
        {graph.links.map((l) => {
          const s = asNode(l.source);
          const t = asNode(l.target);
          const a = graph.at(s);
          const b = graph.at(t);
          return (
            <line
              key={`${s.id}-${t.id}`}
              className="graph-edge"
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              strokeWidth={Math.min(4, l.weight)}
            />
          );
        })}
        {graph.nodes.map((n) => {
          const p = graph.at(n);
          const r = radius(n.count);
          return (
            <g key={n.id} className="graph-node" transform={`translate(${p.x},${p.y})`}>
              <title>{`${n.term} · ${n.count}`}</title>
              <circle r={r} />
              <text y={r + 11} textAnchor="middle">
                {n.term}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
