import { useQuery } from '@tanstack/react-query';
import { Image as ImageIcon, Sigma, Table2 } from 'lucide-react';
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
import { Button } from './button';
import { Dialog } from './dialog';
import { inputPaths } from './editor-helpers';
import { renderMath } from './katex';
import { type Align, coveredBy, parseLatex, type TableModel } from './table-latex';

const ALIGN: Record<Align, 'left' | 'center' | 'right'> = {
  l: 'left',
  c: 'center',
  r: 'right',
};

const jump = (path: string, line: number) => useWorkspaceStore.getState().goToLine(path, line);

type Preview =
  | { kind: 'figure'; item: FigureItem }
  | { kind: 'table'; item: TableItem }
  | { kind: 'equation'; item: EquationItem };

/** The project's figures, tables, equations and acronyms: a rendered preview on click, jump to source. */
export function NavigatorPanel({ projectId }: { projectId: string }) {
  const refs = useService(ReferenceServiceToken);
  const files = useService(FileServiceToken);
  const [preview, setPreview] = useState<Preview | null>(null);
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
          <FigureRow
            key={`${f.path}:${f.line}`}
            item={f}
            projectId={projectId}
            fileSet={fileSet}
            onOpen={() => setPreview({ kind: 'figure', item: f })}
          />
        ))}
      </Section>
      <Section title="Tabelas" count={tables.length}>
        {tables.map((t) => (
          <TableRow
            key={`${t.path}:${t.line}`}
            item={t}
            onOpen={() => setPreview({ kind: 'table', item: t })}
          />
        ))}
      </Section>
      {/* Heavy lists (KaTeX, long) start collapsed so opening the panel stays snappy. */}
      <Section title="Equações" count={equations.length} defaultOpen={false}>
        {equations.map((e) => (
          <EquationRow
            key={`${e.path}:${e.line}`}
            item={e}
            onOpen={() => setPreview({ kind: 'equation', item: e })}
          />
        ))}
      </Section>
      <Section title="Siglas" count={acronyms.length} defaultOpen={false}>
        {acronyms.map((a) => (
          <AcronymRow key={`${a.path}:${a.key}`} item={a} />
        ))}
      </Section>
      <PreviewDialog
        preview={preview}
        projectId={projectId}
        fileSet={fileSet}
        onClose={() => setPreview(null)}
      />
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
  onOpen,
}: {
  item: FigureItem;
  projectId: string;
  fileSet: Set<string>;
  onOpen: () => void;
}) {
  const src = resolveImage(item.image, fileSet);
  return (
    <button type="button" className="nav-item nav-figure" onClick={onOpen}>
      {src ? (
        <BlobImage projectId={projectId} path={src} className="nav-thumb" />
      ) : (
        <div className="nav-thumb nav-thumb-empty" />
      )}
      <span className="nav-item-text">{item.caption || item.label || item.image || 'Figura'}</span>
    </button>
  );
}

function BlobImage({
  projectId,
  path,
  className,
}: {
  projectId: string;
  path: string;
  className: string;
}) {
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
    <img className={className} src={url} alt="" />
  ) : (
    <div className={`${className} nav-thumb-empty`} />
  );
}

function TableRow({ item, onOpen }: { item: TableItem; onOpen: () => void }) {
  return (
    <button type="button" className="nav-item" onClick={onOpen}>
      <Table2 size={15} aria-hidden="true" className="nav-ico" />
      <span className="nav-item-text">{item.caption || item.label || 'Tabela'}</span>
    </button>
  );
}

/** Unescape the common LaTeX specials for display (stays plain text, never HTML). */
const cleanCell = (text: string) => text.replace(/\\([%&_#${}])/g, '$1');

function TableView({ table }: { table: TableModel }) {
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
                    {cleanCell(cell.text)}
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

function EquationRow({ item, onOpen }: { item: EquationItem; onOpen: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) void renderMath(ref.current, item.source, true);
  }, [item.source]);
  return (
    <button type="button" className="nav-item nav-equation" onClick={onOpen}>
      <div className="nav-eq" ref={ref} />
      {item.label && <span className="nav-eq-label">{item.label}</span>}
    </button>
  );
}

function MathView({ tex }: { tex: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) void renderMath(ref.current, tex, true);
  }, [tex]);
  return <div className="nav-eq-full" ref={ref} />;
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

const TITLES = { figure: 'Figura', table: 'Tabela', equation: 'Equação' } as const;
const ICONS = {
  figure: <ImageIcon size={18} />,
  table: <Table2 size={18} />,
  equation: <Sigma size={18} />,
};

/** A rendered preview of the clicked figure/table/equation, with a button to go to its source. */
function PreviewDialog({
  preview,
  projectId,
  fileSet,
  onClose,
}: {
  preview: Preview | null;
  projectId: string;
  fileSet: Set<string>;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (preview && !d.open) d.showModal();
    else if (!preview && d.open) d.close();
    d.addEventListener('close', onClose);
    return () => d.removeEventListener('close', onClose);
  }, [preview, onClose]);

  return (
    <Dialog
      ref={ref}
      title={preview ? TITLES[preview.kind] : 'Pré-visualização'}
      icon={preview ? ICONS[preview.kind] : undefined}
      wide
      footer={
        preview && (
          <>
            <Dialog.Cancel />
            <Button
              variant="primary"
              onClick={() => {
                jump(preview.item.path, preview.item.line);
                ref.current?.close();
              }}
            >
              Ir para o código
            </Button>
          </>
        )
      }
    >
      {preview && <PreviewBody preview={preview} projectId={projectId} fileSet={fileSet} />}
    </Dialog>
  );
}

function PreviewBody({
  preview,
  projectId,
  fileSet,
}: {
  preview: Preview;
  projectId: string;
  fileSet: Set<string>;
}) {
  if (preview.kind === 'figure') {
    const src = resolveImage(preview.item.image, fileSet);
    return (
      <div className="nav-preview">
        {src ? (
          <BlobImage projectId={projectId} path={src} className="nav-preview-img" />
        ) : (
          <p className="nav-empty">Sem pré-visualização (imagem .pdf ou ausente).</p>
        )}
        {preview.item.caption && <p className="nav-preview-caption">{preview.item.caption}</p>}
      </div>
    );
  }
  if (preview.kind === 'equation') {
    return (
      <div className="nav-preview">
        <MathView tex={preview.item.source} />
      </div>
    );
  }
  const parsed = preview.item.source ? safeParse(preview.item.source) : null;
  return (
    <div className="nav-preview">
      {parsed ? (
        <TableView table={parsed.table} />
      ) : (
        <p className="nav-empty">Sem pré-visualização (tabela complexa). Abra o código.</p>
      )}
      {preview.item.caption && <p className="nav-preview-caption">{preview.item.caption}</p>}
    </div>
  );
}

function safeParse(source: string) {
  try {
    return parseLatex(source);
  } catch {
    return null;
  }
}
