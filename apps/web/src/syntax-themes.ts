import type { SyntaxToken, ThemeSetting } from './settings-store';

// Ready-made syntax palettes. Each is a full set of token colours plus the base light/dark theme it
// is meant to sit on, so picking one in the settings dialog is just `set({ theme, syntax })`. The
// per-token colour inputs still work on top for fine-tuning, and "Restaurar padrão" clears them.
export interface SyntaxTheme {
  label: string;
  theme: ThemeSetting;
  syntax: Record<SyntaxToken, string>;
}

export const SYNTAX_THEMES: Record<string, SyntaxTheme> = {
  monokai: {
    label: 'Monokai',
    theme: 'dark',
    syntax: {
      command: '#f92672',
      userCommand: '#fd971f',
      env: '#66d9ef',
      package: '#a6e22e',
      option: '#fd971f',
      heading: '#f92672',
      title: '#e6db74',
      math: '#a6e22e',
      mathCommand: '#66d9ef',
      number: '#ae81ff',
      brace: '#f8f8f2',
      ref: '#ae81ff',
      url: '#66d9ef',
      string: '#e6db74',
      emphasis: '#fd971f',
      verbatim: '#e6db74',
      comment: '#75715e',
      invalid: '#f92672',
    },
  },
  dracula: {
    label: 'Dracula',
    theme: 'dark',
    syntax: {
      command: '#ff79c6',
      userCommand: '#bd93f9',
      env: '#8be9fd',
      package: '#50fa7b',
      option: '#ffb86c',
      heading: '#ff79c6',
      title: '#bd93f9',
      math: '#50fa7b',
      mathCommand: '#8be9fd',
      number: '#bd93f9',
      brace: '#f8f8f2',
      ref: '#bd93f9',
      url: '#8be9fd',
      string: '#f1fa8c',
      emphasis: '#ffb86c',
      verbatim: '#f1fa8c',
      comment: '#6272a4',
      invalid: '#ff5555',
    },
  },
  solarized: {
    label: 'Solarized (claro)',
    theme: 'light',
    syntax: {
      command: '#268bd2',
      userCommand: '#6c71c4',
      env: '#b58900',
      package: '#2aa198',
      option: '#cb4b16',
      heading: '#cb4b16',
      title: '#d33682',
      math: '#859900',
      mathCommand: '#2aa198',
      number: '#d33682',
      brace: '#93a1a1',
      ref: '#cb4b16',
      url: '#268bd2',
      string: '#2aa198',
      emphasis: '#d33682',
      verbatim: '#859900',
      comment: '#93a1a1',
      invalid: '#dc322f',
    },
  },
  github: {
    label: 'GitHub (claro)',
    theme: 'light',
    syntax: {
      command: '#d73a49',
      userCommand: '#6f42c1',
      env: '#22863a',
      package: '#6f42c1',
      option: '#e36209',
      heading: '#22863a',
      title: '#005cc5',
      math: '#032f62',
      mathCommand: '#d73a49',
      number: '#005cc5',
      brace: '#24292e',
      ref: '#e36209',
      url: '#0366d6',
      string: '#032f62',
      emphasis: '#e36209',
      verbatim: '#032f62',
      comment: '#6a737d',
      invalid: '#d73a49',
    },
  },
};

/** The preset whose colours exactly match the current overrides, or '' when custom/none. */
export function activeTheme(syntax: Partial<Record<SyntaxToken, string>>): string {
  const current = JSON.stringify(syntax);
  for (const [id, t] of Object.entries(SYNTAX_THEMES))
    if (JSON.stringify(t.syntax) === current) return id;
  return '';
}
