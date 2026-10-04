import { type RefObject, useRef } from 'react';
import {
  type Settings,
  SYNTAX_TOKENS,
  type SyntaxToken,
  useSettingsStore,
} from '../settings-store';
import { Button } from './button';
import { Dialog } from './dialog';

const FONTS = [
  'ui-monospace, "Cascadia Code", Consolas, monospace',
  '"JetBrains Mono", ui-monospace, monospace',
  '"Fira Code", ui-monospace, monospace',
  'Menlo, Monaco, monospace',
  '"Courier New", monospace',
];
const DEFAULT_FONT = FONTS[0] as string;
const THEMES = { system: 'Sistema', light: 'Claro', dark: 'Escuro' } as const;
const HEX = /^#[0-9a-f]{6}$/i;

const defaultColor = (token: SyntaxToken) => {
  const v = getComputedStyle(document.documentElement).getPropertyValue(`--syn-${token}`).trim();
  if (HEX.test(v)) return v;
  return /^#[0-9a-f]{3}$/i.test(v) ? `#${[...v.slice(1)].map((c) => c + c).join('')}` : '#000000';
};

const APPEARANCE_KEYS = ['theme', 'syntax', 'editorFont', 'fontSize', 'lineWrapping'] as const;

/** Keeps only valid appearance fields from untrusted JSON. */
function parseAppearance(raw: unknown): Partial<Settings> {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out: Partial<Settings> = {};
  if (typeof o.theme === 'string' && Object.hasOwn(THEMES, o.theme))
    out.theme = o.theme as Settings['theme'];
  if (typeof o.editorFont === 'string' && FONTS.includes(o.editorFont))
    out.editorFont = o.editorFont;
  if (typeof o.fontSize === 'number' && o.fontSize >= 11 && o.fontSize <= 20)
    out.fontSize = Math.round(o.fontSize);
  if (typeof o.lineWrapping === 'boolean') out.lineWrapping = o.lineWrapping;
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

export function AppearanceDialog({ ref }: { ref: RefObject<HTMLDialogElement | null> }) {
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
    <Dialog ref={ref} title="Aparência">
      <div className="appearance-dialog">
        <label className="field">
          <span>Tema</span>
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
        </label>
        <label className="field">
          <span>Fonte do editor</span>
          <select value={s.editorFont} onChange={(e) => set({ editorFont: e.target.value })}>
            {FONTS.map((f) => (
              <option key={f} value={f}>
                {(f.split(',')[0] ?? f).replaceAll('"', '')}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Tamanho: {s.fontSize}px</span>
          <input
            type="range"
            min={11}
            max={20}
            value={s.fontSize}
            onChange={(e) => set({ fontSize: Number(e.target.value) })}
          />
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={s.lineWrapping}
            onChange={(e) => set({ lineWrapping: e.target.checked })}
          />
          Quebra de linha
        </label>
        <h3>Cores de sintaxe</h3>
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
        <div className="actions">
          <Button
            variant="ghost"
            onClick={() =>
              set({
                theme: 'system',
                syntax: {},
                editorFont: DEFAULT_FONT,
                fontSize: 14,
                lineWrapping: true,
              })
            }
          >
            Restaurar padrão
          </Button>
          <Button variant="secondary" onClick={exportJson}>
            Exportar JSON
          </Button>
          <Button variant="secondary" onClick={() => importRef.current?.click()}>
            Importar JSON
          </Button>
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
          <Button variant="primary" onClick={() => ref.current?.close()}>
            Fechar
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
