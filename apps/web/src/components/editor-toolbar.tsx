import { openSearchPanel } from '@codemirror/search';
import type { EditorView } from '@codemirror/view';
import {
  Bold,
  Heading,
  Image,
  Italic,
  Link,
  List,
  ListOrdered,
  type LucideIcon,
  Omega,
  Radical,
  Redo2,
  Search,
  Sigma,
  Table,
  Undo2,
} from 'lucide-react';
import { type ReactNode, type RefObject, useCallback, useEffect, useId, useRef } from 'react';
import { yUndoManagerKeymap } from 'y-codemirror.next';
import { useSettingsStore } from '../settings-store';
import { useWorkspaceStore } from '../workspace-store';
import { FormulaDialog, MathPalette } from './formula-dialog';
import {
  insertList,
  insertMath,
  insertSnippet,
  setHeading,
  toggleCommand,
  wrap,
} from './latex-commands';
import { Menu } from './menu';
import { TableDialog } from './table-dialog';
import './editor-tools.css';

type Command = (view: EditorView) => boolean;

// Yjs's undo, not CodeMirror's: the history must not include text that arrived from the server.
const yCommand = (key: string) => yUndoManagerKeymap.find((b) => b.key === key)?.run;
const undo = yCommand('Mod-z');
const redo = yCommand('Mod-y');

const HEADINGS: [string | null, string][] = [
  [null, 'Texto normal'],
  ['chapter', 'Capítulo'],
  ['section', 'Seção'],
  ['subsection', 'Subseção'],
  ['subsubsection', 'Subsubseção'],
  ['paragraph', 'Parágrafo'],
];

/** Menu entries: label, the LaTeX it writes (shown as a hint), the command. */
type Entry = [string, string, Command];

const MATH: Entry[] = [
  ['No texto', '$…$', wrap('$', '$')],
  ['Destacada', '\\[…\\]', wrap('\\[\n  ', '\n\\]')],
];

const REFERENCES: Entry[] = [
  ['Referência', '\\ref', wrap('\\ref{', '}')],
  ['Equação', '\\eqref', wrap('\\eqref{', '}')],
  ['Citação', '\\cite', wrap('\\cite{', '}')],
  ['Rótulo', '\\label', wrap('\\label{', '}')],
  ['Nota de rodapé', '\\footnote', wrap('\\footnote{', '}')],
  ['URL', '\\url', wrap('\\url{', '}')],
  ['Link com texto', '\\href', insertSnippet('\\href{#{url}}{#{texto}}')],
];

const FIGURE = insertSnippet(
  '\\begin{figure}[htbp]\n\t\\centering\n\t\\includegraphics[width=0.8\\linewidth]{#{arquivo}}\n\t\\caption{#{legenda}}\n\t\\label{fig:#{rotulo}}\n\\end{figure}',
);

/** Formatting and insert actions over the editor, Code/Visual switch and search. */
export function EditorToolbar({
  viewRef,
  readOnly,
  isTex,
  children,
}: {
  viewRef: RefObject<EditorView | null>;
  readOnly: boolean;
  isTex: boolean;
  /** Extra actions (comments) placed after the insert groups. */
  children?: ReactNode;
}) {
  const mode = useSettingsStore((s) => s.editorMode);
  const setSettings = useSettingsStore((s) => s.set);
  const dialog = useWorkspaceStore((s) => s.editorDialog);
  const setDialog = useWorkspaceStore((s) => s.setEditorDialog);
  const closeDialog = useCallback(() => setDialog(null), [setDialog]);
  // The state lives in the store: a helper left open must not reopen over the next file.
  useEffect(() => closeDialog, [closeDialog]);
  const run = (cmd: Command | undefined) => {
    const view = viewRef.current;
    if (!view || !cmd) return;
    cmd(view);
    view.focus();
  };
  const edit = isTex && !readOnly;
  const view = viewRef.current;

  return (
    <div className="etb" role="toolbar" aria-label="Ferramentas do editor">
      {!readOnly && (
        <span className="etb-group">
          <ToolButton icon={Undo2} label="Desfazer" keys="Ctrl+Z" onClick={() => run(undo)} />
          <ToolButton icon={Redo2} label="Refazer" keys="Ctrl+Y" onClick={() => run(redo)} />
        </span>
      )}
      {edit && (
        <>
          <span className="etb-sep" aria-hidden="true" />
          <Menu label={<MenuLabel icon={Heading} label="Título" />} triggerClassName="etb-btn">
            {HEADINGS.map(([cmd, label]) => (
              <button key={label} type="button" onClick={() => run(setHeading(cmd))}>
                {label}
              </button>
            ))}
          </Menu>
          <span className="etb-group">
            <ToolButton
              icon={Bold}
              label="Negrito"
              keys="Ctrl+B"
              onClick={() => run(toggleCommand('textbf'))}
            />
            <ToolButton
              icon={Italic}
              label="Itálico"
              keys="Ctrl+I"
              onClick={() => run(toggleCommand('textit'))}
            />
          </span>
          <span className="etb-sep" aria-hidden="true" />
          <span className="etb-group">
            <ToolButton
              icon={Sigma}
              label="Editor de fórmulas"
              onClick={() => setDialog('formula')}
            />
            <SymbolPalette onPick={(tex) => run((v) => insertMath(v, tex))} />
            <Menu
              label={<MenuLabel icon={Radical} label="Matemática" />}
              triggerClassName="etb-btn"
            >
              {MATH.map(([label, hint, cmd]) => (
                <button key={label} type="button" onClick={() => run(cmd)}>
                  {label}
                  <kbd className="etb-hint">{hint}</kbd>
                </button>
              ))}
            </Menu>
          </span>
          <span className="etb-sep" aria-hidden="true" />
          <span className="etb-group">
            <ToolButton
              icon={Table}
              label="Gerador de tabelas"
              onClick={() => setDialog('table')}
            />
            <ToolButton icon={Image} label="Figura" onClick={() => run(FIGURE)} />
            <ToolButton
              icon={List}
              label="Lista com marcadores"
              onClick={() => run(insertList('itemize'))}
            />
            <ToolButton
              icon={ListOrdered}
              label="Lista numerada"
              onClick={() => run(insertList('enumerate'))}
            />
            <Menu
              label={<MenuLabel icon={Link} label="Referências e links" />}
              triggerClassName="etb-btn"
            >
              {REFERENCES.map(([label, hint, cmd]) => (
                <button key={label} type="button" onClick={() => run(cmd)}>
                  {label}
                  <kbd className="etb-hint">{hint}</kbd>
                </button>
              ))}
            </Menu>
          </span>
        </>
      )}
      {children && (
        <>
          <span className="etb-sep" aria-hidden="true" />
          {children}
        </>
      )}
      <span className="etb-spacer" />
      {isTex && (
        <fieldset className="etb-mode">
          <legend className="sr-only">Modo do editor</legend>
          <button
            type="button"
            aria-pressed={mode === 'code'}
            onClick={() => setSettings({ editorMode: 'code' })}
          >
            Código
          </button>
          <button
            type="button"
            aria-pressed={mode === 'visual'}
            title="Títulos, ênfase, fórmulas e listas renderizados; o código aparece onde está o cursor"
            onClick={() => setSettings({ editorMode: 'visual' })}
          >
            Visual
          </button>
        </fieldset>
      )}
      <ToolButton
        icon={Search}
        label="Buscar e substituir"
        keys="Ctrl+F"
        onClick={() => run(openSearchPanel)}
      />
      {view && dialog === 'formula' && <FormulaDialog view={view} onClose={closeDialog} />}
      {view && dialog === 'table' && <TableDialog view={view} onClose={closeDialog} />}
    </div>
  );
}

function ToolButton({
  icon: Icon,
  label,
  keys,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  keys?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="etb-btn"
      aria-label={label}
      title={keys ? `${label} (${keys})` : label}
      onClick={onClick}
    >
      <Icon size={16} aria-hidden="true" />
    </button>
  );
}

function MenuLabel({ icon: Icon, label }: { icon: LucideIcon; label: string }) {
  return (
    <span title={label}>
      <Icon size={16} aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </span>
  );
}

/** Ω: the formula helper's palette in a native popover (light dismiss, Escape, top layer). */
function SymbolPalette({ onPick }: { onPick: (tex: string) => void }) {
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const pop = popover.current;
    if (!pop) return;
    // Under the button, kept inside the viewport once its width is known.
    const place = () => {
      const r = button.current?.getBoundingClientRect();
      if (!r) return;
      pop.style.top = `${r.bottom + 4}px`;
      pop.style.left = `${Math.max(8, Math.min(r.left, innerWidth - pop.offsetWidth - 8))}px`;
    };
    pop.addEventListener('beforetoggle', place);
    pop.addEventListener('toggle', place);
    return () => {
      pop.removeEventListener('beforetoggle', place);
      pop.removeEventListener('toggle', place);
    };
  }, []);
  return (
    <>
      <button
        ref={button}
        type="button"
        className="etb-btn"
        popoverTarget={id}
        aria-label="Símbolos"
        title="Símbolos"
      >
        <Omega size={16} aria-hidden="true" />
      </button>
      <div ref={popover} id={id} popover="auto" className="etb-popover">
        <MathPalette
          onPick={(item) => {
            popover.current?.hidePopover();
            onPick(item.insert ?? item.tex);
          }}
        />
      </div>
    </>
  );
}
