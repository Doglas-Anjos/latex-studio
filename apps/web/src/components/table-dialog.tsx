import { syntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { AlignCenter, AlignLeft, AlignRight, Merge, Minus, Plus, Split, Table } from 'lucide-react';
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
  const p = found && parseLatex(state.sliceDoc(found.from, found.to));
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

interface Pos {
  r: number;
  c: number;
}

export function TableDialog({ view, onClose }: { view: EditorView; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [target] = useState(() => pickTarget(view.state));
  const [table, setTable] = useState(target.table);
  const [options, setOptions] = useState(target.options);
  const [anchor, setAnchor] = useState<Pos>({ r: 0, c: 0 });
  const [focus, setFocus] = useState<Pos>({ r: 0, c: 0 });
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
  const current = table.rows[f.r]?.[f.c];
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
  const delSelected = (del: (t: TableModel, at: number) => TableModel, from: number, to: number) =>
    setTable((t) => {
      let out = t;
      for (let i = to; i >= from; i--) out = del(out, i);
      return out;
    });

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
    for (let i = r + 1; i < nr; i++) {
      const next = ref.current?.querySelector<HTMLInputElement>(`[data-cell="${i},${c}"]`);
      if (next) return next.focus();
    }
  };
  const onPaste = (e: ClipboardEvent, r: number, c: number) => {
    const text = e.clipboardData.getData('text');
    if (!/[\t\n]/.test(text)) return;
    e.preventDefault();
    setTable((t) => pasteGrid(t, r, c, parseTsv(text)));
  };

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
  const rEnd = Math.max(r1, f.r + (current?.rowspan ?? 1) - 1);
  const cEnd = Math.max(c1, f.c + (current?.colspan ?? 1) - 1);

  return (
    <Dialog
      ref={ref}
      title={target.editing ? 'Editar tabela' : 'Tabela'}
      icon={<Table size={18} />}
      wide
      footer={
        <>
          <Dialog.Cancel />
          <Button variant="primary" onClick={insert}>
            {target.editing ? 'Atualizar' : 'Inserir'}
          </Button>
        </>
      }
    >
      <div className="table-dialog-bar" role="toolbar" aria-label="Edição da tabela">
        <Button
          variant="secondary"
          size="compact"
          aria-label="Adicionar linha"
          title="Adicionar linha abaixo"
          onClick={() => setTable((t) => insertRow(t, rEnd + 1))}
        >
          <Plus size={14} aria-hidden="true" /> Linha
        </Button>
        <Button
          variant="secondary"
          size="compact"
          aria-label="Remover linha"
          title="Remover linha"
          disabled={nr - (r1 - r0 + 1) < 1}
          onClick={() => delSelected(deleteRow, r0, r1)}
        >
          <Minus size={14} aria-hidden="true" /> Linha
        </Button>
        <Button
          variant="secondary"
          size="compact"
          aria-label="Adicionar coluna"
          title="Adicionar coluna à direita"
          onClick={() => setTable((t) => insertCol(t, cEnd + 1))}
        >
          <Plus size={14} aria-hidden="true" /> Coluna
        </Button>
        <Button
          variant="secondary"
          size="compact"
          aria-label="Remover coluna"
          title="Remover coluna"
          disabled={nc - (c1 - c0 + 1) < 1}
          onClick={() => delSelected(deleteCol, c0, c1)}
        >
          <Minus size={14} aria-hidden="true" /> Coluna
        </Button>
        <Button
          variant="secondary"
          size="compact"
          title="Mesclar células selecionadas"
          disabled={!merged}
          onClick={() => merged && setTable(merged)}
        >
          <Merge size={14} aria-hidden="true" /> Mesclar
        </Button>
        <Button
          variant="secondary"
          size="compact"
          title="Separar célula mesclada"
          disabled={!isSpan}
          onClick={() => setTable((t) => split(t, f.r, f.c))}
        >
          <Split size={14} aria-hidden="true" /> Separar
        </Button>
        {(
          [
            ['l', AlignLeft, 'Alinhar à esquerda'],
            ['c', AlignCenter, 'Centralizar'],
            ['r', AlignRight, 'Alinhar à direita'],
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
      </div>

      <div className="table-dialog-grid">
        <table>
          <tbody>
            {table.rows.map((row, r) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: rows have no identity
              <tr key={r} data-head={(options.header && r === 0) || undefined}>
                {row.map((cell, c) => {
                  if (cov[r]?.[c]) return null;
                  const selected = r >= r0 && r <= r1 && c >= c0 && c <= c1;
                  return (
                    <td
                      // biome-ignore lint/suspicious/noArrayIndexKey: cells have no identity
                      key={c}
                      colSpan={cell.colspan ?? 1}
                      rowSpan={cell.rowspan ?? 1}
                      data-sel={selected || undefined}
                    >
                      <input
                        data-cell={`${r},${c}`}
                        aria-label={`Linha ${r + 1}, coluna ${c + 1}`}
                        value={cell.text}
                        style={{
                          textAlign: ({ l: 'left', c: 'center', r: 'right' } as const)[
                            table.align[c] ?? 'c'
                          ],
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

      {target.editing && (
        <p className="table-dialog-packages">
          Editando só o tabular: legenda, rótulo e posição ficam como estão no documento.
        </p>
      )}
      <div className="table-dialog-options">
        <label>
          Estilo
          <select
            value={options.style}
            onChange={(e) => set('style', e.target.value as TableOptions['style'])}
          >
            <option value="booktabs">Profissional (booktabs)</option>
            <option value="grid">Grade completa</option>
            <option value="lines">Linhas horizontais</option>
            <option value="plain">Sem linhas</option>
          </select>
        </label>
        <label className="table-dialog-check">
          <input
            type="checkbox"
            checked={options.header}
            onChange={(e) => set('header', e.target.checked)}
          />
          Primeira linha é cabeçalho
        </label>
        <label className="table-dialog-check">
          <input
            type="checkbox"
            checked={options.float}
            disabled={target.editing}
            onChange={(e) => set('float', e.target.checked)}
          />
          Ambiente flutuante (table)
        </label>
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
        <label>
          Fonte (abnTeX2)
          <input
            value={options.source}
            disabled={floatOff}
            onChange={(e) => set('source', e.target.value)}
          />
          <small>Gera \fonte{'{...}'} abaixo da tabela.</small>
        </label>
        <label className="table-dialog-check">
          <input
            type="checkbox"
            checked={options.escape}
            onChange={(e) => set('escape', e.target.checked)}
          />
          {'Escapar caracteres especiais (& % $ # _ { } ~ ^ \\)'}
        </label>
      </div>

      <pre className="table-dialog-code">
        <code>{code}</code>
      </pre>
      {packages.length > 0 && (
        <p className="table-dialog-packages">
          Pacotes necessários: {packages.join(', ')} (ative-os em Pacotes)
        </p>
      )}
    </Dialog>
  );
}
