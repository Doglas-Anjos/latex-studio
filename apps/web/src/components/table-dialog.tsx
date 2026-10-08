import { syntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Baseline,
  Bold,
  Check,
  Copy,
  Italic,
  Maximize2,
  Merge,
  Minimize2,
  Minus,
  PaintBucket,
  Plus,
  RemoveFormatting,
  Split,
  Table,
  Underline,
} from 'lucide-react';
import { type ClipboardEvent, type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { Button } from './button';
import { Dialog } from './dialog';
import { onOwnLines } from './latex-commands';
import './table-dialog.css';
import {
  type Align,
  coveredBy,
  DEFAULT_OPTIONS,
  deleteCol,
  deleteRow,
  emptyTable,
  formatCells,
  insertCol,
  insertRow,
  merge,
  parseLatex,
  parseTsv,
  pasteGrid,
  split,
  type TableModel,
  type TableOptions,
  toLatex,
} from './table-latex';

interface Target {
  from: number;
  to: number;
  editing: boolean;
  table: TableModel;
  options: TableOptions;
}

/**
 * Existing tabular under the cursor, or inside the selection / enclosing table float, else a new
 * 3x3 at the selection. Only the tabular is replaced, so the float's own commands survive.
 */
export function pickTarget(state: EditorState): Target {
  const sel = state.selection.main;
  const tree = syntaxTree(state);
  let tabular: { from: number; to: number } | null = null;
  let float: { from: number; to: number } | null = null;
  // Both sides: the caret may sit right before \begin{tabular} or right after \end{tabular}.
  for (const side of [-1, 1] as const) {
    for (
      let n: ReturnType<typeof tree.resolveInner> | null = tree.resolveInner(sel.head, side);
      n;
      n = n.parent
    ) {
      // Copy the range: a lezer node's from/to are getters, a spread would drop them.
      if (n.name === 'TabularEnvironment') tabular ??= { from: n.from, to: n.to };
      else if (n.name === 'TableEnvironment') float = { from: n.from, to: n.to };
    }
  }
  const range = sel.empty ? float : sel;
  if (!tabular && range) {
    tree.iterate({
      from: range.from,
      to: range.to,
      enter: (n) => {
        if (tabular) return false;
        if (n.name === 'TabularEnvironment') {
          tabular = { from: n.from, to: n.to };
          return false;
        }
      },
    });
  }
  const found: { from: number; to: number } | null = tabular;
  const text = found ? state.sliceDoc(found.from, found.to) : '';
  // The grammar also calls tabularx/longtable TabularEnvironment; only plain tabular parses.
  const p = text.startsWith('\\begin{tabular}') ? parseLatex(text) : null;
  return (
    (found &&
      p && {
        ...found,
        editing: true,
        table: p.table,
        options: { ...DEFAULT_OPTIONS, ...p.options, float: false },
      }) || {
      from: sel.from,
      to: sel.to,
      editing: false,
      table: emptyTable(3, 3),
      options: DEFAULT_OPTIONS,
    }
  );
}

type FormatPatch = Parameters<typeof formatCells>[5];

// value, chip label, tooltip
const TABLE_STYLES = [
  ['booktabs', 'Profissional', 'Regras booktabs (toprule/midrule/bottomrule)'],
  ['grid', 'Grade', 'Todas as bordas'],
  ['lines', 'Linhas', 'Só linhas horizontais'],
  ['plain', 'Sem linhas', 'Nenhuma borda'],
] as const;

const FORMATS = [
  ['bold', Bold, 'Negrito'],
  ['italic', Italic, 'Itálico'],
  ['underline', Underline, 'Sublinhado'],
] as const;

const CLEAR: FormatPatch = {
  bold: undefined,
  italic: undefined,
  underline: undefined,
  color: undefined,
  bg: undefined,
};

interface Pos {
  r: number;
  c: number;
}

/** Spreadsheet column name: A…Z, AA, AB… */
const colName = (i: number): string =>
  (i >= 26 ? colName(Math.floor(i / 26) - 1) : '') + String.fromCharCode(65 + (i % 26));
const hex = (c?: string) => (c ? `#${c}` : undefined);

export function TableDialog({ view, onClose }: { view: EditorView; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [target] = useState(() => pickTarget(view.state));
  const [table, setTable] = useState(target.table);
  const [options, setOptions] = useState(target.options);
  const [anchor, setAnchor] = useState<Pos>({ r: 0, c: 0 });
  const [focus, setFocus] = useState<Pos>({ r: 0, c: 0 });
  const [full, setFull] = useState(false);
  const [copied, setCopied] = useState(false);
  // Set before a programmatic focus so onFocus keeps the range selection.
  const keepSel = useRef(false);

  useEffect(() => {
    const dlg = ref.current;
    if (dlg && !dlg.open) dlg.showModal();
    dlg?.addEventListener('close', onClose);
    return () => dlg?.removeEventListener('close', onClose);
  }, [onClose]);

  // The target as the editor's selection: CodeMirror maps it through collaborators' edits
  // while the dialog is open, so the insert lands where the table still is.
  useEffect(() => {
    view.dispatch({ selection: { anchor: target.from, head: target.to } });
  }, [view, target]);

  const nr = table.rows.length;
  const nc = table.align.length;
  const clamp = (p: Pos): Pos => ({ r: Math.min(p.r, nr - 1), c: Math.min(p.c, nc - 1) });
  const [a, f] = [clamp(anchor), clamp(focus)];
  const [r0, r1] = [Math.min(a.r, f.r), Math.max(a.r, f.r)];
  const [c0, c1] = [Math.min(a.c, f.c), Math.max(a.c, f.c)];
  const merged = merge(table, r0, c0, r1, c1);
  const cov = coveredBy(table);
  // The focused cell, or the merged cell it sits in.
  const [fr, fc] = cov[f.r]?.[f.c] ?? [f.r, f.c];
  const current = table.rows[fr]?.[fc];
  const isSpan = !!current && ((current.colspan ?? 1) > 1 || (current.rowspan ?? 1) > 1);
  const { code, packages } = toLatex(table, options);

  const set = <K extends keyof TableOptions>(k: K, v: TableOptions[K]) =>
    setOptions((o) => ({ ...o, [k]: v }));
  const setText = (r: number, c: number, text: string) =>
    setTable((t) => ({
      ...t,
      rows: t.rows.map((row, i) =>
        i === r ? row.map((cell, j) => (j === c ? { ...cell, text } : cell)) : row,
      ),
    }));
  const setAlign = (al: Align) =>
    setTable((t) => ({ ...t, align: t.align.map((x, i) => (i >= c0 && i <= c1 ? al : x)) }));
  const format = (patch: FormatPatch) => setTable((t) => formatCells(t, r0, c0, r1, c1, patch));
  const delSelected = (del: (t: TableModel, at: number) => TableModel, from: number, to: number) =>
    setTable((t) => {
      let out = t;
      for (let i = to; i >= from; i--) out = del(out, i);
      return out;
    });
  // Header letters and row numbers select a whole column or row; Shift extends the range.
  const select = (from: Pos, to: Pos, extend: boolean) => {
    if (!extend) setAnchor(from);
    setFocus(to);
  };

  const focusCell = (r: number, c: number) =>
    ref.current?.querySelector<HTMLInputElement>(`[data-cell="${r},${c}"]`)?.focus();
  const onKeyDown = (e: KeyboardEvent, r: number, c: number) => {
    const d: number[] | undefined = {
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
    }[e.key];
    if (e.shiftKey && d) {
      // Shift+Arrow extends the range; the focus may sit inside a span, so focus its origin.
      e.preventDefault();
      const nf = clamp({
        r: Math.max(0, f.r + (d[0] ?? 0)),
        c: Math.max(0, f.c + (d[1] ?? 0)),
      });
      const o = cov[nf.r]?.[nf.c] ?? [nf.r, nf.c];
      setFocus(nf);
      keepSel.current = true;
      focusCell(o[0], o[1]);
      keepSel.current = false;
      return;
    }
    if (e.key !== 'Enter') return;
    e.preventDefault();
    for (let i = r + 1; i < nr; i++) if (!cov[i]?.[c]) return focusCell(i, c);
  };
  const onPaste = (e: ClipboardEvent, r: number, c: number) => {
    const text = e.clipboardData.getData('text');
    if (!/[\t\n]/.test(text)) return;
    e.preventDefault();
    setTable((t) => pasteGrid(t, r, c, parseTsv(text)));
  };

  const copy = () =>
    navigator.clipboard.writeText(code).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => {},
    );
  const insert = () => {
    if (view.state.readOnly) return;
    const { from, to } = view.state.selection.main;
    // An edited tabular keeps the indentation it had inside its float.
    const indent = /^\s*/.exec(view.state.doc.lineAt(from).text)?.[0] ?? '';
    const text = target.editing
      ? code.replaceAll('\n', `\n${indent}`)
      : onOwnLines(view.state, from, to, code);
    view.dispatch({
      changes: { from, to, insert: text },
      selection: { anchor: from + text.length },
      userEvent: 'input',
    });
    // Unmount now: the close event waits for a rendering frame (never comes in a hidden tab).
    ref.current?.close();
    onClose();
    view.focus();
  };

  const alignOf = (al: Align) => table.align.slice(c0, c1 + 1).every((x) => x === al);
  const floatOff = !options.float || target.editing;
  // New rows/columns go after the focused cell's whole span, so a merged cell is not split.
  const rEnd = Math.max(r1, fr + (current?.rowspan ?? 1) - 1);
  const cEnd = Math.max(c1, fc + (current?.colspan ?? 1) - 1);
  const inRows = (r: number) => r >= r0 && r <= r1;
  const inCols = (c: number) => c >= c0 && c <= c1;

  return (
    <Dialog
      ref={ref}
      title={target.editing ? 'Editar tabela' : 'Tabela'}
      icon={<Table size={18} />}
      wide={full ? 'full' : true}
      actions={
        <Button
          variant="ghost"
          size="icon"
          aria-label="Tela cheia"
          title={full ? 'Sair da tela cheia' : 'Tela cheia'}
          aria-pressed={full}
          onClick={() => setFull((v) => !v)}
        >
          {full ? (
            <Minimize2 size={16} aria-hidden="true" />
          ) : (
            <Maximize2 size={16} aria-hidden="true" />
          )}
        </Button>
      }
      footer={
        <>
          <Dialog.Cancel />
          <Button variant="secondary" onClick={copy}>
            {copied ? (
              <Check size={16} aria-hidden="true" />
            ) : (
              <Copy size={16} aria-hidden="true" />
            )}
            {copied ? 'Copiado' : 'Copiar código'}
          </Button>
          <Button variant="primary" onClick={insert}>
            {target.editing ? 'Atualizar' : 'Inserir'}
          </Button>
        </>
      }
    >
      <div className="table-dialog" data-full={full || undefined}>
        <div className="table-dialog-main">
          <div className="table-dialog-bar" role="toolbar" aria-label="Edição da tabela">
            <span className="table-dialog-group">
              <Button
                variant="ghost"
                size="compact"
                aria-label="Adicionar linha"
                title="Adicionar linha abaixo"
                onClick={() => setTable((t) => insertRow(t, rEnd + 1))}
              >
                <Plus size={14} aria-hidden="true" /> Linha
              </Button>
              <Button
                variant="ghost"
                size="compact"
                aria-label="Remover linha"
                title="Remover as linhas selecionadas"
                disabled={nr - (r1 - r0 + 1) < 1}
                onClick={() => delSelected(deleteRow, r0, r1)}
              >
                <Minus size={14} aria-hidden="true" /> Linha
              </Button>
              <Button
                variant="ghost"
                size="compact"
                aria-label="Adicionar coluna"
                title="Adicionar coluna à direita"
                onClick={() => setTable((t) => insertCol(t, cEnd + 1))}
              >
                <Plus size={14} aria-hidden="true" /> Coluna
              </Button>
              <Button
                variant="ghost"
                size="compact"
                aria-label="Remover coluna"
                title="Remover as colunas selecionadas"
                disabled={nc - (c1 - c0 + 1) < 1}
                onClick={() => delSelected(deleteCol, c0, c1)}
              >
                <Minus size={14} aria-hidden="true" /> Coluna
              </Button>
            </span>
            <span className="table-dialog-group">
              <Button
                variant="ghost"
                size="compact"
                title="Mesclar as células selecionadas"
                disabled={!merged}
                onClick={() => merged && setTable(merged)}
              >
                <Merge size={14} aria-hidden="true" /> Mesclar
              </Button>
              <Button
                variant="ghost"
                size="compact"
                title="Separar a célula mesclada"
                disabled={!isSpan}
                onClick={() => setTable((t) => split(t, fr, fc))}
              >
                <Split size={14} aria-hidden="true" /> Separar
              </Button>
            </span>
            <span className="table-dialog-group">
              {(
                [
                  ['l', AlignLeft, 'Alinhar coluna à esquerda'],
                  ['c', AlignCenter, 'Centralizar coluna'],
                  ['r', AlignRight, 'Alinhar coluna à direita'],
                ] as const
              ).map(([al, Icon, label]) => (
                <Button
                  key={al}
                  variant="ghost"
                  size="icon"
                  aria-label={label}
                  title={label}
                  aria-pressed={alignOf(al)}
                  onClick={() => setAlign(al)}
                >
                  <Icon size={16} aria-hidden="true" />
                </Button>
              ))}
            </span>
            <span className="table-dialog-group">
              {FORMATS.map(([key, Icon, label]) => (
                <Button
                  key={key}
                  variant="ghost"
                  size="icon"
                  aria-label={label}
                  title={label}
                  aria-pressed={!!current?.[key]}
                  onClick={() => format({ [key]: current?.[key] ? undefined : true })}
                >
                  <Icon size={16} aria-hidden="true" />
                </Button>
              ))}
              <label className="table-dialog-color" title="Cor do texto">
                <Baseline size={16} aria-hidden="true" />
                <input
                  type="color"
                  aria-label="Cor do texto"
                  value={hex(current?.color) ?? '#000000'}
                  onChange={(e) => format({ color: e.target.value.slice(1).toUpperCase() })}
                />
              </label>
              <label className="table-dialog-color" title="Cor de fundo da célula">
                <PaintBucket size={16} aria-hidden="true" />
                <input
                  type="color"
                  aria-label="Cor de fundo da célula"
                  value={hex(current?.bg) ?? '#ffffff'}
                  onChange={(e) => format({ bg: e.target.value.slice(1).toUpperCase() })}
                />
              </label>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Limpar formatação"
                title="Limpar formatação (negrito, itálico, sublinhado e cores)"
                onClick={() => format(CLEAR)}
              >
                <RemoveFormatting size={16} aria-hidden="true" />
              </Button>
            </span>
          </div>

          <p className="table-dialog-hint">
            Cole uma tabela do Excel ou Google Sheets com <kbd>Ctrl</kbd>+<kbd>V</kbd> em qualquer
            célula. Clique na letra ou no número para selecionar a coluna ou a linha;{' '}
            <kbd>Shift</kbd>+clique (ou <kbd>Shift</kbd>+setas) estende a seleção.
          </p>
          <div className="table-dialog-grid">
            <table>
              <thead>
                <tr>
                  <td className="table-dialog-corner" />
                  {table.align.map((_, c) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: columns have no identity
                    <th key={c} data-sel={inCols(c) || undefined}>
                      <button
                        type="button"
                        aria-label={`Selecionar a coluna ${colName(c)}`}
                        title={`Selecionar a coluna ${colName(c)}`}
                        onClick={(e) => select({ r: 0, c }, { r: nr - 1, c }, e.shiftKey)}
                      >
                        {colName(c)}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((row, r) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: rows have no identity
                  <tr key={r} data-head={(options.header && r === 0) || undefined}>
                    <th data-sel={inRows(r) || undefined}>
                      <button
                        type="button"
                        aria-label={`Selecionar a linha ${r + 1}`}
                        title={`Selecionar a linha ${r + 1}`}
                        onClick={(e) => select({ r, c: 0 }, { r, c: nc - 1 }, e.shiftKey)}
                      >
                        {r + 1}
                      </button>
                    </th>
                    {row.map((cell, c) => {
                      if (cov[r]?.[c]) return null;
                      return (
                        <td
                          // biome-ignore lint/suspicious/noArrayIndexKey: cells have no identity
                          key={c}
                          colSpan={cell.colspan ?? 1}
                          rowSpan={cell.rowspan ?? 1}
                          data-sel={(inRows(r) && inCols(c)) || undefined}
                          style={{ background: hex(cell.bg) }}
                        >
                          <input
                            data-cell={`${r},${c}`}
                            aria-label={`Célula ${colName(c)}${r + 1}`}
                            value={cell.text}
                            style={{
                              textAlign: ({ l: 'left', c: 'center', r: 'right' } as const)[
                                table.align[c] ?? 'c'
                              ],
                              fontWeight: cell.bold ? 700 : undefined,
                              fontStyle: cell.italic ? 'italic' : undefined,
                              textDecoration: cell.underline ? 'underline' : undefined,
                              color: hex(cell.color),
                            }}
                            onChange={(e) => setText(r, c, e.target.value)}
                            onMouseDown={(e) => {
                              // Shift+click extends the selection and keeps the anchor.
                              if (!e.shiftKey) return;
                              e.preventDefault();
                              setFocus({ r, c });
                            }}
                            onFocus={() => {
                              if (keepSel.current) return;
                              setAnchor({ r, c });
                              setFocus({ r, c });
                            }}
                            onKeyDown={(e) => onKeyDown(e, r, c)}
                            onPaste={(e) => onPaste(e, r, c)}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="table-dialog-side">
          {target.editing && (
            <p className="table-dialog-note">
              Editando só o tabular: legenda, rótulo e posição ficam como estão no documento.
            </p>
          )}
          <div className="table-dialog-options">
            <div className="table-dialog-field table-dialog-wide">
              <span>Estilo</span>
              <div className="table-dialog-chips" role="radiogroup" aria-label="Estilo da tabela">
                {TABLE_STYLES.map(([v, text, title]) => (
                  <button
                    key={v}
                    type="button"
                    title={title}
                    aria-pressed={options.style === v}
                    onClick={() => set('style', v)}
                  >
                    {text}
                  </button>
                ))}
              </div>
            </div>
            <div className="table-dialog-checks table-dialog-wide">
              <label>
                <input
                  type="checkbox"
                  checked={options.header}
                  onChange={(e) => set('header', e.target.checked)}
                />
                Primeira linha é cabeçalho
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={options.float}
                  disabled={target.editing}
                  onChange={(e) => set('float', e.target.checked)}
                />
                Ambiente flutuante (table)
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={options.escape}
                  onChange={(e) => set('escape', e.target.checked)}
                />
                {'Escapar caracteres especiais (& % $ # _ { } ~ ^ \\)'}
              </label>
            </div>
            <label>
              Posição
              <input
                value={options.position}
                disabled={floatOff}
                onChange={(e) => set('position', e.target.value)}
              />
            </label>
            <label>
              Legenda
              <input
                value={options.caption}
                disabled={floatOff}
                onChange={(e) => set('caption', e.target.value)}
              />
            </label>
            <label>
              Rótulo
              <input
                value={options.label}
                placeholder="tab:minha-tabela"
                disabled={floatOff}
                onChange={(e) => set('label', e.target.value)}
              />
            </label>
            <label title="abnTeX2: gera \fonte{…} abaixo da tabela">
              Fonte (abnTeX2)
              <input
                value={options.source}
                placeholder="Elaborado pelo autor"
                disabled={floatOff}
                onChange={(e) => set('source', e.target.value)}
              />
            </label>
          </div>

          <pre className="table-dialog-code">
            <code>{code}</code>
          </pre>
          {packages.length > 0 && (
            <p className="table-dialog-note">
              Pacotes necessários: {packages.join(', ')} (ative-os em Pacotes)
            </p>
          )}
          <p className="table-dialog-note">
            Copiar não insere a tabela no documento: só uma tabela inserida pode ser reaberta aqui
            para edição (botão “Editar tabela” ao lado do <code>\begin{'{tabular}'}</code>).
          </p>
        </div>
      </div>
    </Dialog>
  );
}
