import { useQuery } from '@tanstack/react-query';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { useService } from '../di/service-provider';
import { FileServiceToken } from '../services/file.service';
import {
  type AcronymItem,
  type EquationItem,
  type FigureItem,
  ReferenceServiceToken,
  type TableItem,
} from '../services/reference.service';
import { useWorkspaceStore } from '../workspace-store';
import { inputPaths } from './editor-helpers';
import { renderMath } from './katex';
import { type Align, coveredBy, parseLatex, type TableModel } from './table-latex';

const ALIGN: Record<Align, 'left' | 'center' | 'right'> = {
  l: 'left',
  c: 'center',
  r: 'right',
};

const jump = (path: string, line: number) => useWorkspaceStore.getState().goToLine(path, line);

/** The project's figures, tables, equations and acronyms, each jumping to source, with a preview. */
export function NavigatorPanel({ projectId }: { projectId: string }) {
  const refs = useService(ReferenceServiceToken);
  const files = useService(FileServiceToken);
  const outline = useQuery({
    queryKey: ['references', projectId, 'outline'],
    queryFn: () => refs.outline(projectId),
    staleTime: 15_000,
  });
  const fileList = useQuery({
    queryKey: ['files', projectId],
    queryFn: () => files.list(projectId),
    staleTime: 15_000,
  });
  const fileSet = useMemo(() => new Set((fileList.data ?? []).map((f) => f.path)), [fileList.data]);

  if (outline.isPending) return <p className="status-note">Carregando…</p>;
  if (outline.error) return <p className="form-error">Erro ao ler o documento.</p>;
  const { figures, tables, equations, acronyms } = outline.data;

  return (
    <div className="navigator">
      <Section title="Figuras" count={figures.length}>
        {figures.map((f) => (
          <FigureRow key={`${f.path}:${f.line}`} item={f} projectId={projectId} fileSet={fileSet} />
        ))}
      </Section>
      <Section title="Tabelas" count={tables.length}>
        {tables.map((t) => (
          <TableRow key={`${t.path}:${t.line}`} item={t} />
        ))}
      </Section>
      {/* Heavy lists (KaTeX, long) start collapsed so opening the panel stays snappy. */}
      <Section title="Equações" count={equations.length} defaultOpen={false}>
        {equations.map((e) => (
          <EquationRow key={`${e.path}:${e.line}`} item={e} />
        ))}
      </Section>
      <Section title="Siglas" count={acronyms.length} defaultOpen={false}>
        {acronyms.map((a) => (
          <AcronymRow key={`${a.path}:${a.key}`} item={a} />
        ))}
      </Section>
    </div>
  );
}

function Section({
  title,
  count,
  defaultOpen = true,
  children,
}: {
  title: string;
  count: number;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen && count > 0);
  return (
    <details
      className="nav-section"
      open={open}
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary>
        {title}
        <span className="nav-count">{count}</span>
      </summary>
      {/* Children mount only while open: collapsed sections don't render thumbnails or KaTeX. */}
      {count === 0 ? (
        <p className="nav-empty">Nenhum item.</p>
      ) : open ? (
        <div className="nav-list">{children}</div>
      ) : null}
    </details>
  );
}

/** Resolve a \includegraphics arg to an existing, previewable (non-PDF) project file, or null. */
function resolveImage(image: string | undefined, fileSet: Set<string>): string | null {
  if (!image) return null;
  for (const p of inputPaths(image, true)) {
    if (p.toLowerCase().endsWith('.pdf')) continue;
    if (fileSet.has(p)) return p;
  }
  return null;
}

function FigureRow({
  item,
  projectId,
  fileSet,
}: {
  item: FigureItem;
  projectId: string;
  fileSet: Set<string>;
}) {
  const src = resolveImage(item.image, fileSet);
  return (
    <button
      type="button"
      className="nav-item nav-figure"
      onClick={() => jump(item.path, item.line)}
    >
      {src ? (
        <Thumb projectId={projectId} path={src} />
      ) : (
        <div className="nav-thumb nav-thumb-empty" />
      )}
      <span className="nav-item-text">{item.caption || item.label || item.image || 'Figura'}</span>
    </button>
  );
}

function Thumb({ projectId, path }: { projectId: string; path: string }) {
  const files = useService(FileServiceToken);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    let obj: string | null = null;
    files
      .blob(projectId, path)
      .then((b) => {
        if (!live) return;
        obj = URL.createObjectURL(b);
        setUrl(obj);
      })
      .catch(() => {});
    return () => {
      live = false;
      if (obj) URL.revokeObjectURL(obj);
    };
  }, [files, projectId, path]);
  return url ? (
    <img className="nav-thumb" src={url} alt="" />
  ) : (
    <div className="nav-thumb nav-thumb-empty" />
  );
}

function TableRow({ item }: { item: TableItem }) {
  const parsed = useMemo(() => {
    try {
      return item.source ? parseLatex(item.source) : null;
    } catch {
      return null;
    }
  }, [item.source]);
  return (
    <button
      type="button"
      className="nav-item nav-table-item"
      onClick={() => jump(item.path, item.line)}
    >
      <span className="nav-item-text">{item.caption || item.label || 'Tabela'}</span>
      {parsed && <TablePreview table={parsed.table} />}
    </button>
  );
}

function TablePreview({ table }: { table: TableModel }) {
  const cov = coveredBy(table);
  return (
    <div className="nav-table-preview">
      <table>
        <tbody>
          {table.rows.map((row, r) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: preview rows have no identity
            <tr key={r}>
              {row.map((cell, c) =>
                cov[r]?.[c] ? null : (
                  <td
                    // biome-ignore lint/suspicious/noArrayIndexKey: preview cells have no identity
                    key={c}
                    colSpan={cell.colspan ?? 1}
                    rowSpan={cell.rowspan ?? 1}
                    style={{
                      textAlign: ALIGN[table.align[c] ?? 'c'],
                      ...(cell.bold ? { fontWeight: 700 } : {}),
                      ...(cell.italic ? { fontStyle: 'italic' } : {}),
                      ...(cell.underline ? { textDecoration: 'underline' } : {}),
                      ...(cell.color ? { color: `#${cell.color}` } : {}),
                      ...(cell.bg ? { background: `#${cell.bg}` } : {}),
                    }}
                  >
                    {cell.text}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EquationRow({ item }: { item: EquationItem }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) void renderMath(ref.current, item.source, true);
  }, [item.source]);
  return (
    <button
      type="button"
      className="nav-item nav-equation"
      onClick={() => jump(item.path, item.line)}
    >
      <div className="nav-eq" ref={ref} />
      {item.label && <span className="nav-eq-label">{item.label}</span>}
    </button>
  );
}

function AcronymRow({ item }: { item: AcronymItem }) {
  return (
    <button
      type="button"
      className="nav-item nav-acronym"
      onClick={() => jump(item.path, item.line)}
    >
      <span className="nav-acro-short">{item.short}</span>
      <span className="nav-acro-long">{item.long}</span>
    </button>
  );
}
