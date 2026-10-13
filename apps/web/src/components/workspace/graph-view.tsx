import { useQuery } from '@tanstack/react-query';
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force';
import { useEffect, useMemo, useRef } from 'react';
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
    .force('charge', forceManyBody().strength(-260))
    .force('center', forceCenter(0, 0))
    .force(
      'collide',
      forceCollide<SimNode>().radius((d) => radius(d.count) + 8),
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
    const nodes: SimNode[] = topics.data.nodes.map((n) => ({
      id: n.term,
      term: n.term,
      count: n.count,
    }));
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

  // The laid-out graph is usually larger than the sidebar; open it centred rather than at a corner.
  const box = useRef<HTMLDivElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-centre whenever a new graph is laid out.
  useEffect(() => {
    const el = box.current;
    if (el) {
      el.scrollLeft = (el.scrollWidth - el.clientWidth) / 2;
      el.scrollTop = (el.scrollHeight - el.clientHeight) / 2;
    }
  }, [graph]);

  if (topics.isPending) return <p className="status-note">Analisando o texto…</p>;
  if (topics.error) return <p className="form-error">Erro ao ler o documento.</p>;
  if (!graph || graph.nodes.length === 0)
    return <p className="nav-empty">Nenhum assunto encontrado (texto curto demais).</p>;

  return (
    <div className="graph-view" ref={box}>
      <svg
        width={graph.width}
        height={graph.height}
        viewBox={`0 0 ${graph.width} ${graph.height}`}
        aria-label="Grafo de assuntos"
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
