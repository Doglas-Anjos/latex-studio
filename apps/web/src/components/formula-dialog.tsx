import { syntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { Sigma } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from './button';
import { Dialog } from './dialog';
import './formula-dialog.css';
import { mathHtml, renderMath } from './katex';
import { MATH_NODES, onOwnLines } from './latex-commands';
import { MATH_PALETTE, type PaletteItem } from './math-palette';

export type MathMode = 'inline' | 'display' | 'equation' | 'align';

export function wrapFormula(body: string, mode: MathMode, label: string): string {
  if (mode === 'inline') return `$${body}$`;
  if (mode === 'display') return `\\[\n  ${body}\n\\]`;
  const lab = mode === 'equation' && label ? `\n  \\label{${label}}` : '';
  return `\\begin{${mode}}\n  ${body}${lab}\n\\end{${mode}}`;
}

const DELIMS: [RegExp, MathMode][] = [
  [/^\$\$([\s\S]*)\$\$$/, 'display'],
  [/^\\\[([\s\S]*)\\\]$/, 'display'],
  [/^\$([\s\S]*)\$$/, 'inline'],
  [/^\\\(([\s\S]*)\\\)$/, 'inline'],
  [/^\\begin\{equation\}([\s\S]*)\\end\{equation\}$/, 'equation'],
  [/^\\begin\{align\}([\s\S]*)\\end\{align\}$/, 'align'],
];

/**
 * Inverse of wrapFormula; null for anything it cannot represent losslessly (starred and other
 * environments). Only equation extracts its \label; in align labels stay inside the body.
 */
export function unwrapFormula(
  text: string,
): { body: string; mode: MathMode; label: string } | null {
  const t = text.trim();
  for (const [re, mode] of DELIMS) {
    const body = re.exec(t)?.[1];
    if (body === undefined) continue;
    const lab = mode === 'equation' ? /\\label\{([^{}]*)\}/.exec(body) : null;
    return {
      body: (lab ? body.replace(/\\label\{[^{}]*\}/, '') : body).trim(),
      mode,
      label: lab?.[1] ?? '',
    };
  }
  return null;
}

function initial(state: EditorState) {
  const { from, to, head } = state.selection.main;
  const raw = (body: string) => ({
    body,
    mode: 'inline' as MathMode,
    label: '',
    env: undefined as string | undefined,
  });
  if (from !== to) {
    const sel = state.sliceDoc(from, to);
    return { from, to, editing: false, ...raw(''), ...(unwrapFormula(sel) ?? raw(sel)) };
  }
  // Both sides: a click on a rendered formula (visual mode) leaves the caret at its first character.
  for (const side of [-1, 1] as const)
    for (
      let n = syntaxTree(state).resolveInner(head, side) as
        | ReturnType<typeof syntaxTree>['topNode']
        | null;
      n;
      n = n.parent
    ) {
      if (!MATH_NODES.has(n.name)) continue;
      const text = state.sliceDoc(n.from, n.to);
      const u = unwrapFormula(text);
      if (u) return { from: n.from, to: n.to, editing: true, ...u, env: undefined };
      const b = n.getChild('BeginEnv');
      const e = n.getChild('EndEnv');
      if (b && e) {
        // Any other environment (equation*, align*, gather…): edit only its body.
        const env = /\\begin\{([^{}]*)\}/.exec(state.sliceDoc(b.from, b.to))?.[1];
        return {
          from: b.to,
          to: e.from,
          editing: true,
          ...raw(state.sliceDoc(b.to, e.from).trim()),
          env,
        };
      }
      return { from: n.from, to: n.to, editing: true, ...raw(text) };
    }
  return { from: head, to: head, editing: false, ...raw('') };
}

const htmlCache = new Map<string, string[]>();

export function MathPalette({ onPick }: { onPick: (item: PaletteItem) => void }) {
  const [tab, setTab] = useState(MATH_PALETTE[0]?.id);
  const [, rerender] = useState(0);
  const cat = MATH_PALETTE.find((c) => c.id === tab) ?? MATH_PALETTE[0];
  const html = cat && htmlCache.get(cat.id);

  useEffect(() => {
    if (!cat || htmlCache.has(cat.id)) return;
    let live = true;
    Promise.all(cat.items.map((i) => mathHtml(i.tex))).then((h) => {
      htmlCache.set(cat.id, h);
      if (live) rerender((n) => n + 1);
    });
    return () => {
      live = false;
    };
  }, [cat]);

  return (
    <div className="math-palette">
      <fieldset className="math-palette-tabs" aria-label="Categorias de símbolos">
        {MATH_PALETTE.map((c) => (
          <button
            key={c.id}
            type="button"
            aria-pressed={c.id === cat?.id}
            onClick={() => setTab(c.id)}
          >
            {c.name}
          </button>
        ))}
      </fieldset>
      <div className="math-palette-grid">
        {cat?.items.map((item, i) => (
          <button
            key={item.title}
            type="button"
            title={item.title}
            aria-label={item.title}
            // Keep the caret and selection in the editor/textarea while picking.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onPick(item)}
          >
            {html?.[i] ? (
              // biome-ignore lint/security/noDangerouslySetInnerHtml: our own catalog strings, never user text
              <span dangerouslySetInnerHTML={{ __html: html[i] }} />
            ) : (
              <span>{item.tex}</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

// value, chip glyph, tooltip
const MATRICES = [
  ['matrix', '▦', 'Sem delimitador (matrix)'],
  ['pmatrix', '( )', 'Parênteses (pmatrix)'],
  ['bmatrix', '[ ]', 'Colchetes (bmatrix)'],
  ['Bmatrix', '{ }', 'Chaves (Bmatrix)'],
  ['vmatrix', '| |', 'Determinante (vmatrix)'],
  ['Vmatrix', '‖ ‖', 'Norma (Vmatrix)'],
] as const;

const MODES: [MathMode, string][] = [
  ['inline', 'No texto $…$'],
  ['display', 'Destacada \\[…\\]'],
  ['equation', 'Numerada (equation)'],
  ['align', 'Alinhada (align)'],
];

export function FormulaDialog({ view, onClose }: { view: EditorView; onClose: () => void }) {
  const [init] = useState(() => initial(view.state));
  const [body, setBody] = useState(init.body);
  const [mode, setMode] = useState(init.mode);
  const [label, setLabel] = useState(init.label);
  const [rows, setRows] = useState(2);
  const [cols, setCols] = useState(2);
  const [matrix, setMatrix] = useState<string>('pmatrix');
  const ref = useRef<HTMLDialogElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const preview = useRef<HTMLDivElement>(null);
  const caret = useRef<number | null>(null);
  const { env } = init;
  const previewTex = env
    ? `\\begin{${env}}${body}\\end{${env}}`
    : mode === 'align'
      ? `\\begin{aligned}${body}\\end{aligned}`
      : body;

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (!d.open) d.showModal();
    d.addEventListener('close', onClose);
    return () => d.removeEventListener('close', onClose);
  }, [onClose]);

  // The target as the editor's selection: CodeMirror maps it through collaborators' edits
  // while the dialog is open, so the insert lands where the formula still is.
  useEffect(() => {
    view.dispatch({ selection: { anchor: init.from, head: init.to } });
  }, [view, init]);

  useEffect(() => {
    const el = preview.current;
    if (!el) return;
    if (!body.trim()) el.textContent = '';
    else void renderMath(el, previewTex, true);
  }, [body, previewTex]);

  // Restore the caret after React re-renders the controlled textarea.
  useEffect(() => {
    if (caret.current === null || !area.current) return;
    area.current.focus();
    area.current.setSelectionRange(caret.current, caret.current);
    caret.current = null;
  });

  const pick = (item: PaletteItem) => {
    const ta = area.current;
    if (!ta) return;
    let ins = item.insert ?? item.tex;
    // A trailing space keeps `\alpha` from gluing to the next letter.
    if (/\\[a-zA-Z]+$/.test(ins)) ins += ' ';
    const { selectionStart: s, selectionEnd: e, value } = ta;
    const sel = value.slice(s, e);
    const slot = ins.indexOf('{}');
    let pos = s + ins.length;
    if (slot >= 0) {
      ins = ins.slice(0, slot + 1) + sel + ins.slice(slot + 1);
      pos = s + slot + 1 + sel.length;
    }
    caret.current = pos;
    setBody(value.slice(0, s) + ins + value.slice(e));
  };

  const insertMatrix = () => {
    const row = `  ${Array<string>(cols).fill('').join('  &  ')}`;
    const text = `\\begin{${matrix}}\n${Array<string>(rows).fill(row).join(' \\\\\n')}\n\\end{${matrix}}`;
    pick({ tex: text, title: '' });
  };

  const submit = () => {
    if (!body.trim() || view.state.readOnly) return;
    const { from, to } = view.state.selection.main;
    const formula = wrapFormula(body.trim(), mode, label.trim());
    const text = env
      ? `\n  ${body.trim()}\n`
      : mode === 'inline'
        ? formula
        : onOwnLines(view.state, from, to, formula);
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

  return (
    <Dialog
      ref={ref}
      title={init.editing ? 'Editar fórmula' : 'Fórmula'}
      icon={<Sigma size={18} />}
      wide
      footer={
        <>
          <Dialog.Cancel />
          <Button variant="primary" disabled={!body.trim()} onClick={submit}>
            {init.editing ? 'Atualizar' : 'Inserir'}
          </Button>
        </>
      }
    >
      <div className="formula">
        <p className="formula-hint">
          Clique num símbolo da paleta ou digite LaTeX no campo abaixo. <kbd>Ctrl</kbd>+
          <kbd>Enter</kbd> insere.
        </p>
        <MathPalette onPick={pick} />
        <div className="formula-matrix">
          <label>
            Linhas
            <input
              type="number"
              min={1}
              max={10}
              value={rows}
              onChange={(e) => setRows(Math.min(10, Math.max(1, Number(e.target.value) || 1)))}
            />
          </label>
          <label>
            Colunas
            <input
              type="number"
              min={1}
              max={10}
              value={cols}
              onChange={(e) => setCols(Math.min(10, Math.max(1, Number(e.target.value) || 1)))}
            />
          </label>
          <div className="formula-chips" role="radiogroup" aria-label="Delimitador da matriz">
            {MATRICES.map(([v, glyph, title]) => (
              <button
                key={v}
                type="button"
                title={title}
                aria-label={title}
                aria-pressed={matrix === v}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setMatrix(v)}
              >
                {glyph}
              </button>
            ))}
          </div>
          <Button variant="secondary" size="compact" onClick={insertMatrix}>
            Inserir matriz
          </Button>
        </div>
        <textarea
          ref={area}
          className="formula-code"
          aria-label="Código LaTeX da fórmula"
          spellCheck={false}
          autoFocus
          rows={4}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <div className="formula-preview" aria-live="polite" ref={preview} />
        {env ? (
          <p className="formula-hint">Ambiente {env} mantido</p>
        ) : (
          <>
            <div className="formula-modes" role="radiogroup" aria-label="Tipo de fórmula">
              {MODES.map(([m, text]) => (
                <label key={m}>
                  <input
                    type="radio"
                    name="formula-mode"
                    checked={mode === m}
                    onChange={() => setMode(m)}
                  />
                  <span>{text}</span>
                </label>
              ))}
            </div>
            {mode === 'equation' && (
              <label className="formula-label">
                Rótulo
                <input
                  value={label}
                  placeholder="eq:minha-formula"
                  onChange={(e) => setLabel(e.target.value)}
                />
              </label>
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}
