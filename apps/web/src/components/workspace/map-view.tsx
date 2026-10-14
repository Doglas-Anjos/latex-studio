import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useService } from '../../di/service-provider';
import { ReferenceServiceToken, type SectionItem } from '../../services/reference.service';
import { useWorkspaceStore } from '../../workspace-store';

// A horizontal mind-map of the document's sectioning: the root on the left, chapters/sections
// nesting to the right, each node a jump to its source line. Laid out with plain SVG (no deps):
// every leaf takes one row, a parent sits at the mid-row of its subtree.
const ROW_H = 30;
const COL_W = 172;
const NODE_W = 150;
const NODE_H = 22;
const PAD = 16;

interface MapNode {
  label: string;
  section?: SectionItem;
  children: MapNode[];
  x: number;
  y: number;
}

/** Drop the common LaTeX markup so a title reads as plain text in a node. */
const clean = (t: string) =>
  t
    .replace(/\\[a-zA-Z]+\*?\s*/g, '')
    .replace(/[{}$]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

function buildTree(sections: SectionItem[], rootLabel: string): { root: MapNode; height: number } {
  const root: MapNode = { label: rootLabel, children: [], x: 0, y: 0 };
  const stack: { level: number; node: MapNode }[] = [{ level: -1, node: root }];
  for (const s of sections) {
    while (stack.length > 1 && (stack[stack.length - 1] as { level: number }).level >= s.level)
      stack.pop();
    const node: MapNode = {
      label: clean(s.title) || '(sem título)',
      section: s,
      children: [],
      x: 0,
      y: 0,
    };
    (stack[stack.length - 1] as { node: MapNode }).node.children.push(node);
    stack.push({ level: s.level, node });
  }

  let nextRow = 0;
  const place = (node: MapNode, depth: number) => {
    node.x = depth * COL_W;
    if (node.children.length === 0) {
      node.y = nextRow * ROW_H;
      nextRow++;
      return;
    }
    for (const c of node.children) place(c, depth + 1);
    const first = node.children[0] as MapNode;
    const last = node.children[node.children.length - 1] as MapNode;
    node.y = (first.y + last.y) / 2;
  };
  place(root, 0);
  return { root, height: Math.max(1, nextRow) * ROW_H };
}

function flatten(root: MapNode): MapNode[] {
  const out: MapNode[] = [];
  const walk = (n: MapNode) => {
    out.push(n);
    n.children.forEach(walk);
  };
  walk(root);
  return out;
}

export function MapView({ projectId }: { projectId: string }) {
  const refs = useService(ReferenceServiceToken);
  const outline = useQuery({
    queryKey: ['references', projectId, 'outline'],
    queryFn: () => refs.outline(projectId),
    staleTime: 15_000,
  });

  const tree = useMemo(
    () => (outline.data ? buildTree(outline.data.sections, 'Documento') : null),
    [outline.data],
  );

  if (outline.isPending) return <p className="status-note">Carregando…</p>;
  if (outline.error) return <p className="form-error">Erro ao ler o documento.</p>;
  if (!tree || tree.root.children.length === 0)
    return <p className="nav-empty">Nenhuma seção encontrada (\section, \chapter…).</p>;

  const nodes = flatten(tree.root);
  const maxDepth = Math.max(...nodes.map((n) => n.x)) / COL_W;
  const width = maxDepth * COL_W + NODE_W + PAD * 2;
  const height = tree.height + PAD * 2;
  const cy = (n: MapNode) => n.y + PAD + NODE_H / 2;

  return (
    <div className="map-view">
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        aria-label="Mapa de seções"
      >
        {nodes.flatMap((n) =>
          n.children.map((c) => {
            const x1 = n.x + PAD + NODE_W;
            const x2 = c.x + PAD;
            const mid = (x1 + x2) / 2;
            return (
              <path
                key={`e:${c.section?.path}:${c.section?.line}:${c.label}`}
                className="map-edge"
                d={`M${x1},${cy(n)} C${mid},${cy(n)} ${mid},${cy(c)} ${x2},${cy(c)}`}
                fill="none"
              />
            );
          }),
        )}
        {nodes.map((n) => {
          const s = n.section;
          const jump = s ? () => useWorkspaceStore.getState().goToLine(s.path, s.line) : undefined;
          return (
            // biome-ignore lint/a11y/noStaticElementInteractions: SVG has no interactive element; a focusable <g> with onClick + key handler is the accessible option.
            <g
              key={s ? `${s.path}:${s.line}` : 'root'}
              className="map-node"
              data-level={s ? s.level : 'root'}
              transform={`translate(${n.x + PAD},${n.y + PAD})`}
              onClick={jump}
              onKeyDown={
                jump &&
                ((e) => {
                  if (e.key !== 'Enter' && e.key !== ' ') return;
                  e.preventDefault(); // Space would also scroll the map
                  jump();
                })
              }
              role={s ? 'button' : undefined}
              aria-label={s ? `Ir para ${n.label}` : undefined}
              tabIndex={s ? 0 : undefined}
              style={s ? { cursor: 'pointer' } : undefined}
            >
              <title>{n.label}</title>
              <rect width={NODE_W} height={NODE_H} rx={NODE_H / 2} />
              <text x={10} y={NODE_H / 2} dominantBaseline="central">
                {n.label.length > 20 ? `${n.label.slice(0, 19)}…` : n.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
