import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';

export type SyntaxToken =
  | 'command'
  | 'env'
  | 'math'
  | 'brace'
  | 'string'
  | 'ref'
  | 'heading'
  | 'comment'
  | 'number'
  | 'verbatim'
  | 'emphasis'
  | 'invalid';

export const SYNTAX_TOKENS: { token: SyntaxToken; label: string }[] = [
  { token: 'command', label: 'Comandos' },
  { token: 'env', label: 'Ambientes' },
  { token: 'math', label: 'Matemática' },
  { token: 'brace', label: 'Chaves' },
  { token: 'string', label: 'Strings' },
  { token: 'ref', label: 'Referências' },
  { token: 'heading', label: 'Títulos' },
  { token: 'comment', label: 'Comentários' },
  { token: 'number', label: 'Números' },
  { token: 'verbatim', label: 'Verbatim' },
  { token: 'emphasis', label: 'Ênfase' },
  { token: 'invalid', label: 'Inválido' },
];

export type ThemeSetting = 'light' | 'dark' | 'system';
export type SidebarView = 'files' | 'changes' | 'packages' | 'comments' | 'history' | 'members';

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
