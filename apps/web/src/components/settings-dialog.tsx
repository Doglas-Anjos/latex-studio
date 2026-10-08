import { Code2, FileText, Palette, Settings as SettingsIcon } from 'lucide-react';
import { type ReactNode, type RefObject, useRef, useState } from 'react';
import {
  type DiffView,
  type Settings,
  SYNTAX_TOKENS,
  type SyntaxToken,
  useSettingsStore,
} from '../settings-store';
import { Button } from './button';
import { Dialog } from './dialog';

// Bundled fonts (main.tsx) render the same on every machine; "Sistema" is the OS monospace.
const FONTS: [label: string, value: string][] = [
  ['Sistema', 'ui-monospace, "Cascadia Code", Consolas, monospace'],
  ['JetBrains Mono', '"JetBrains Mono", ui-monospace, monospace'],
  ['Fira Code', '"Fira Code", ui-monospace, monospace'],
  ['IBM Plex Mono', '"IBM Plex Mono", ui-monospace, monospace'],
  ['Courier New', '"Courier New", monospace'],
];
const DEFAULT_FONT = FONTS[0]?.[1] as string;
const THEMES = { system: 'Sistema', light: 'Claro', dark: 'Escuro' } as const;
const DIFF_VIEWS: [DiffView, string][] = [
  ['auto', 'Automático'],
  ['split', 'Lado a lado'],
  ['unified', 'Unificado'],
  ['words', 'Palavras'],
];
const EDITOR_MODES: [Settings['editorMode'], string][] = [
  ['code', 'Código'],
  ['visual', 'Visual'],
];
const HEX = /^#[0-9a-f]{6}$/i;

const defaultColor = (token: SyntaxToken) => {
  const v = getComputedStyle(document.documentElement).getPropertyValue(`--syn-${token}`).trim();
  if (HEX.test(v)) return v;
  return /^#[0-9a-f]{3}$/i.test(v) ? `#${[...v.slice(1)].map((c) => c + c).join('')}` : '#000000';
};

const APPEARANCE_KEYS = ['theme', 'syntax', 'editorFont', 'fontSize'] as const;

/** Keeps only valid appearance fields from untrusted JSON. */
function parseAppearance(raw: unknown): Partial<Settings> {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out: Partial<Settings> = {};
  if (typeof o.theme === 'string' && Object.hasOwn(THEMES, o.theme))
    out.theme = o.theme as Settings['theme'];
  if (typeof o.editorFont === 'string' && FONTS.some(([, v]) => v === o.editorFont))
    out.editorFont = o.editorFont;
  if (typeof o.fontSize === 'number' && o.fontSize >= 11 && o.fontSize <= 20)
    out.fontSize = Math.round(o.fontSize);
  if (o.syntax && typeof o.syntax === 'object') {
    const syntax: Settings['syntax'] = {};
    for (const { token } of SYNTAX_TOKENS) {
      const v = (o.syntax as Record<string, unknown>)[token];
      if (typeof v === 'string' && HEX.test(v)) syntax[token] = v;
    }
    out.syntax = syntax;
  }
  return out;
}

type Category = 'editor' | 'compile' | 'appearance';
const CATEGORIES: { id: Category; label: string; icon: ReactNode }[] = [
  { id: 'editor', label: 'Editor', icon: <Code2 size={16} aria-hidden="true" /> },
  { id: 'compile', label: 'Compilação', icon: <FileText size={16} aria-hidden="true" /> },
  { id: 'appearance', label: 'Aparência', icon: <Palette size={16} aria-hidden="true" /> },
];

/** Local preferences (saved in this browser), grouped like Overleaf's settings. */
export function SettingsDialog({ ref }: { ref: RefObject<HTMLDialogElement | null> }) {
  const [cat, setCat] = useState<Category>('editor');
  return (
    <Dialog
      ref={ref}
      title="Configurações"
      icon={<SettingsIcon size={18} aria-hidden="true" />}
      kicker="Preferências locais"
      wide
      footer={
        <Button variant="primary" onClick={() => ref.current?.close()}>
          Fechar
        </Button>
      }
    >
      <div className="settings">
        <nav className="settings-nav" aria-label="Categorias de configuração">
          {CATEGORIES.map((c) => (
            <button
              key={c.id}
              type="button"
              className="settings-nav-btn"
              aria-pressed={cat === c.id}
              onClick={() => setCat(c.id)}
            >
              {c.icon}
              {c.label}
            </button>
          ))}
        </nav>
        <div className="settings-main">
          {cat === 'editor' && <EditorPanel />}
          {cat === 'compile' && <CompilePanel />}
          {cat === 'appearance' && <AppearancePanel />}
        </div>
      </div>
    </Dialog>
  );
}

function Row({
  title,
  description,
  control,
}: {
  title: string;
  description?: string;
  control: ReactNode;
}) {
  return (
    <div className="settings-row">
      <div className="settings-row-text">
        <span className="settings-row-title">{title}</span>
        {description && <span className="settings-row-desc">{description}</span>}
      </div>
      {control}
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="toggle">
      <input
        type="checkbox"
        checked={checked}
        aria-label={label}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="toggle-track" aria-hidden="true" />
    </label>
  );
}

function EditorPanel() {
  const s = useSettingsStore();
  const { set } = s;
  return (
    <div className="settings-section">
      <Row
        title="Modo do editor (arquivos .tex)"
        description="Código mostra o LaTeX; Visual renderiza títulos, ênfase e matemática."
        control={
          <select
            value={s.editorMode}
            onChange={(e) => set({ editorMode: e.target.value as Settings['editorMode'] })}
          >
            {EDITOR_MODES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        }
      />
      <Row
        title="Quebra de linha"
        description="Quebra linhas longas em vez de rolar na horizontal."
        control={
          <Toggle
            checked={s.lineWrapping}
            onChange={(v) => set({ lineWrapping: v })}
            label="Quebra de linha"
          />
        }
      />
      <Row
        title="Comparação de versões"
        description="Layout padrão ao ver diferenças entre versões."
        control={
          <select
            value={s.diffView}
            onChange={(e) => set({ diffView: e.target.value as DiffView })}
          >
            {DIFF_VIEWS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        }
      />
    </div>
  );
}

function CompilePanel() {
  const s = useSettingsStore();
  const { set } = s;
  return (
    <div className="settings-section">
      <Row
        title="Compilação automática"
        description="Recompila alguns segundos após você parar de digitar."
        control={
          <Toggle
            checked={s.autoCompile}
            onChange={(v) => set({ autoCompile: v })}
            label="Compilação automática"
          />
        }
      />
      <Row
        title="Modo rascunho"
        description="Imagens como molduras, sem marcas de overflow — compila mais rápido."
        control={
          <Toggle
            checked={s.draftMode}
            onChange={(v) => set({ draftMode: v })}
            label="Modo rascunho"
          />
        }
      />
      <Row
        title="Parar no primeiro erro"
        description="Interrompe a compilação no primeiro erro, para corrigir um de cada vez."
        control={
          <Toggle
            checked={s.stopOnFirstError}
            onChange={(v) => set({ stopOnFirstError: v })}
            label="Parar no primeiro erro"
          />
        }
      />
    </div>
  );
}

function AppearancePanel() {
  const s = useSettingsStore();
  const { set } = s;
  const importRef = useRef<HTMLInputElement>(null);

  const exportJson = () => {
    const data = Object.fromEntries(APPEARANCE_KEYS.map((k) => [k, s[k]]));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(
      new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
    );
    a.download = 'latex-studio-theme.json';
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const importJson = async (file: File | undefined) => {
    if (!file) return;
    try {
      set(parseAppearance(JSON.parse(await file.text())));
    } catch {
      // invalid JSON: ignore
    }
  };

  return (
    <div className="settings-section">
      <Row
        title="Tema"
        control={
          <select
            value={s.theme}
            onChange={(e) => set({ theme: e.target.value as Settings['theme'] })}
          >
            {Object.entries(THEMES).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        }
      />
      <Row
        title="Tamanho da fonte"
        description={`${s.fontSize}px`}
        control={
          <input
            type="range"
            min={11}
            max={20}
            value={s.fontSize}
            aria-label="Tamanho da fonte"
            onChange={(e) => set({ fontSize: Number(e.target.value) })}
          />
        }
      />
      {/* Each choice previews itself in its own font, size and syntax colours. */}
      <fieldset className="font-choices">
        <legend>Fonte do editor</legend>
        {FONTS.map(([name, f]) => (
          <label key={f} className="font-choice">
            <input
              type="radio"
              name="editor-font"
              value={f}
              checked={s.editorFont === f}
              onChange={() => set({ editorFont: f })}
            />
            <span className="font-choice-name">{name}</span>
            <code
              className="font-sample"
              aria-hidden="true"
              style={{ fontFamily: f, fontSize: s.fontSize }}
            >
              <span className="s-heading">{String.raw`\section`}</span>
              <span className="s-brace">{'{'}</span>
              <span className="s-title">Introdução</span>
              <span className="s-brace">{'}'}</span> <span className="s-comment">% 0O 1lI</span>
              {'\n'}
              <span className="s-math">{String.raw`$\alpha \neq x^2 -> y$`}</span>{' '}
              <span className="s-command">{String.raw`\cite`}</span>
              <span className="s-brace">{'{'}</span>
              <span className="s-ref">silva2020</span>
              <span className="s-brace">{'}'}</span>
            </code>
          </label>
        ))}
      </fieldset>
      <h3 className="settings-h3">Cores de sintaxe</h3>
      <div className="color-grid">
        {SYNTAX_TOKENS.map(({ token, label }) => (
          <label key={token} className="check">
            <input
              type="color"
              value={s.syntax[token] ?? defaultColor(token)}
              onChange={(e) => set({ syntax: { ...s.syntax, [token]: e.target.value } })}
            />
            {label}
          </label>
        ))}
      </div>
      <div className="settings-appearance-actions">
        <Button
          variant="ghost"
          size="compact"
          onClick={() =>
            set({ theme: 'system', syntax: {}, editorFont: DEFAULT_FONT, fontSize: 14 })
          }
        >
          Restaurar padrão
        </Button>
        <Button variant="secondary" size="compact" onClick={exportJson}>
          Exportar JSON
        </Button>
        <Button variant="secondary" size="compact" onClick={() => importRef.current?.click()}>
          Importar JSON
        </Button>
      </div>
      <input
        ref={importRef}
        type="file"
        accept="application/json"
        hidden
        aria-label="Importar JSON"
        onChange={(e) => {
          importJson(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
    </div>
  );
}
