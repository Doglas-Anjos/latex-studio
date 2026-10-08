import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';

export type SyntaxToken =
  | 'command'
  | 'userCommand'
  | 'env'
  | 'package'
  | 'option'
  | 'heading'
  | 'title'
  | 'math'
  | 'mathCommand'
  | 'number'
  | 'brace'
  | 'ref'
  | 'url'
  | 'string'
  | 'emphasis'
  | 'verbatim'
  | 'comment'
  | 'invalid';

export const SYNTAX_TOKENS: { token: SyntaxToken; label: string }[] = [
  { token: 'command', label: 'Comandos' },
  { token: 'userCommand', label: 'Comandos próprios' },
  { token: 'env', label: 'Ambientes' },
  { token: 'package', label: 'Pacotes e classe' },
  { token: 'option', label: 'Opções [..]' },
  { token: 'heading', label: 'Comandos de seção' },
  { token: 'title', label: 'Títulos de seção' },
  { token: 'math', label: 'Matemática' },
  { token: 'mathCommand', label: 'Comandos matemáticos' },
  { token: 'number', label: 'Números' },
  { token: 'brace', label: 'Chaves e operadores' },
  { token: 'ref', label: 'Rótulos e citações' },
  { token: 'url', label: 'URLs' },
  { token: 'string', label: 'Caminhos e strings' },
  { token: 'emphasis', label: 'Ênfase e negrito' },
  { token: 'verbatim', label: 'Verbatim' },
  { token: 'comment', label: 'Comentários' },
  { token: 'invalid', label: 'Inválido' },
];

export type ThemeSetting = 'light' | 'dark' | 'system';
export type SidebarView = 'files' | 'changes' | 'packages' | 'comments' | 'history' | 'members';
/** Diff layout; 'auto' lets the available width pick split vs unified. */
export type DiffView = 'split' | 'unified' | 'words' | 'auto';

export interface Settings {
  theme: ThemeSetting;
  syntax: Partial<Record<SyntaxToken, string>>;
  editorFont: string;
  fontSize: number;
  lineWrapping: boolean;
  sidebarWidth: number;
  pdfWidth: number;
  panelHeight: number;
  sidebarView: SidebarView;
  /** Remembered diff layout across tabs and reloads. */
  diffView: DiffView;
  panelOpen: boolean;
  /** Compile a few seconds after the document stops changing. */
  autoCompile: boolean;
  /** Images as frames, no overfull marks (faster). */
  draftMode: boolean;
  /** false = keep compiling past errors and still get a PDF. */
  stopOnFirstError: boolean;
}

interface SettingsState extends Settings {
  set: (patch: Partial<Settings>) => void;
  reset: () => void;
}

const defaults: Settings = {
  theme: 'system',
  syntax: {},
  editorFont: 'ui-monospace, "Cascadia Code", Consolas, monospace',
  fontSize: 14,
  lineWrapping: true,
  sidebarWidth: 260,
  pdfWidth: 480,
  panelHeight: 220,
  sidebarView: 'files',
  diffView: 'auto',
  panelOpen: false,
  autoCompile: false,
  draftMode: false,
  stopOnFirstError: true,
};

export const resolveTheme = (theme: ThemeSetting, prefersDark: boolean): 'light' | 'dark' =>
  theme === 'system' ? (prefersDark ? 'dark' : 'light') : theme;

// Absent or throwing localStorage (privacy modes) falls back to memory.
const memory = new Map<string, string>();
const storage: StateStorage = {
  getItem: (k) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return memory.get(k) ?? null;
    }
  },
  setItem: (k, v) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      memory.set(k, v);
    }
  },
  removeItem: (k) => {
    try {
      localStorage.removeItem(k);
    } catch {
      memory.delete(k);
    }
  },
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      ...defaults,
      set: (patch) => set(patch),
      reset: () => set(defaults),
    }),
    {
      name: 'latex-studio.settings',
      version: 1,
      storage: createJSONStorage(() => storage),
    },
  ),
);
