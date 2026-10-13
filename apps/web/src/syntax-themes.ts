import type { SyntaxToken } from './settings-store';

// A syntax theme is a *family* with a dark and a light palette. Picking one sets `syntaxTheme`; the
// base theme (claro/escuro/sistema) then decides which palette applies, so switching light/dark
// keeps the family and swaps the colours. Per-token overrides (`syntax`) still layer on top.
export interface SyntaxTheme {
  label: string;
  dark: Record<SyntaxToken, string>;
  light: Record<SyntaxToken, string>;
}

// A palette is authored as a handful of roles and expanded to the 18 tokens, so each variant stays
// a dozen lines and the mapping is consistent across themes.
interface Roles {
  keyword: string; // control sequences and sectioning commands
  func: string; // user commands, emphasis
  type: string; // environments, packages/class
  type2: string; // math commands (\alpha…)
  attr: string; // [options]
  title: string; // section title text
  string: string; // math, strings/paths, verbatim
  number: string;
  ref: string; // labels and cite keys
  url: string;
  fg: string; // braces/operators
  comment: string;
  error: string; // invalid
}

const expand = (r: Roles): Record<SyntaxToken, string> => ({
  command: r.keyword,
  heading: r.keyword,
  userCommand: r.func,
  emphasis: r.func,
  env: r.type,
  package: r.type,
  mathCommand: r.type2,
  option: r.attr,
  title: r.title,
  math: r.string,
  string: r.string,
  verbatim: r.string,
  number: r.number,
  ref: r.ref,
  url: r.url,
  brace: r.fg,
  comment: r.comment,
  invalid: r.error,
});

export const SYNTAX_THEMES: Record<string, SyntaxTheme> = {
  darcula: {
    label: 'Darcula',
    // dark: JetBrains Darcula · light: IntelliJ Light
    dark: expand({
      keyword: '#cc7832',
      func: '#ffc66d',
      type: '#9876aa',
      type2: '#8888c6',
      attr: '#bbb529',
      title: '#ffc66d',
      string: '#6a8759',
      number: '#6897bb',
      ref: '#9876aa',
      url: '#287bde',
      fg: '#a9b7c6',
      comment: '#808080',
      error: '#bc3f3c',
    }),
    light: expand({
      keyword: '#0033b3',
      func: '#00627a',
      type: '#871094',
      type2: '#871094',
      attr: '#9e880d',
      title: '#00627a',
      string: '#067d17',
      number: '#1750eb',
      ref: '#871094',
      url: '#1a5eb8',
      fg: '#080808',
      comment: '#8c8c8c',
      error: '#e00000',
    }),
  },
  one: {
    label: 'One',
    // Atom / VS Code One Dark & One Light
    dark: expand({
      keyword: '#c678dd',
      func: '#61afef',
      type: '#e5c07b',
      type2: '#56b6c2',
      attr: '#d19a66',
      title: '#e06c75',
      string: '#98c379',
      number: '#d19a66',
      ref: '#56b6c2',
      url: '#61afef',
      fg: '#abb2bf',
      comment: '#5c6370',
      error: '#e06c75',
    }),
    light: expand({
      keyword: '#a626a4',
      func: '#4078f2',
      type: '#c18401',
      type2: '#0184bc',
      attr: '#986801',
      title: '#e45649',
      string: '#50a14f',
      number: '#986801',
      ref: '#0184bc',
      url: '#4078f2',
      fg: '#383a42',
      comment: '#a0a1a7',
      error: '#e45649',
    }),
  },
  solarized: {
    label: 'Solarized',
    dark: expand({
      keyword: '#859900',
      func: '#268bd2',
      type: '#b58900',
      type2: '#2aa198',
      attr: '#cb4b16',
      title: '#d33682',
      string: '#2aa198',
      number: '#d33682',
      ref: '#6c71c4',
      url: '#268bd2',
      fg: '#839496',
      comment: '#586e75',
      error: '#dc322f',
    }),
    light: expand({
      keyword: '#859900',
      func: '#268bd2',
      type: '#b58900',
      type2: '#2aa198',
      attr: '#cb4b16',
      title: '#d33682',
      string: '#2aa198',
      number: '#d33682',
      ref: '#6c71c4',
      url: '#268bd2',
      fg: '#657b83',
      comment: '#93a1a1',
      error: '#dc322f',
    }),
  },
  github: {
    label: 'GitHub',
    dark: expand({
      keyword: '#ff7b72',
      func: '#d2a8ff',
      type: '#ffa657',
      type2: '#79c0ff',
      attr: '#ffa657',
      title: '#7ee787',
      string: '#a5d6ff',
      number: '#79c0ff',
      ref: '#d2a8ff',
      url: '#a5d6ff',
      fg: '#c9d1d9',
      comment: '#8b949e',
      error: '#ff7b72',
    }),
    light: expand({
      keyword: '#cf222e',
      func: '#8250df',
      type: '#953800',
      type2: '#0550ae',
      attr: '#953800',
      title: '#116329',
      string: '#0a3069',
      number: '#0550ae',
      ref: '#8250df',
      url: '#0a3069',
      fg: '#24292f',
      comment: '#6e7781',
      error: '#cf222e',
    }),
  },
  monokai: {
    label: 'Monokai',
    dark: expand({
      keyword: '#f92672',
      func: '#fd971f',
      type: '#66d9ef',
      type2: '#66d9ef',
      attr: '#fd971f',
      title: '#e6db74',
      string: '#e6db74',
      number: '#ae81ff',
      ref: '#ae81ff',
      url: '#66d9ef',
      fg: '#f8f8f2',
      comment: '#75715e',
      error: '#f92672',
    }),
    light: expand({
      keyword: '#e7005f',
      func: '#c7620b',
      type: '#1c8fa3',
      type2: '#1c8fa3',
      attr: '#c7620b',
      title: '#8a7b00',
      string: '#8a7b00',
      number: '#7a3edb',
      ref: '#7a3edb',
      url: '#1c8fa3',
      fg: '#333333',
      comment: '#9a9a9a',
      error: '#e7005f',
    }),
  },
  dracula: {
    label: 'Dracula',
    dark: expand({
      keyword: '#ff79c6',
      func: '#bd93f9',
      type: '#8be9fd',
      type2: '#8be9fd',
      attr: '#ffb86c',
      title: '#bd93f9',
      string: '#f1fa8c',
      number: '#bd93f9',
      ref: '#bd93f9',
      url: '#8be9fd',
      fg: '#f8f8f2',
      comment: '#6272a4',
      error: '#ff5555',
    }),
    // light: "Alucard", Dracula's official light variant
    light: expand({
      keyword: '#a3144d',
      func: '#644ac9',
      type: '#036a96',
      type2: '#036a96',
      attr: '#a34d14',
      title: '#644ac9',
      string: '#846e15',
      number: '#644ac9',
      ref: '#644ac9',
      url: '#036a96',
      fg: '#1f1f1f',
      comment: '#6c664b',
      error: '#cb3a2a',
    }),
  },
  nord: {
    label: 'Nord',
    dark: expand({
      keyword: '#81a1c1',
      func: '#88c0d0',
      type: '#8fbcbb',
      type2: '#8fbcbb',
      attr: '#d08770',
      title: '#b48ead',
      string: '#a3be8c',
      number: '#b48ead',
      ref: '#b48ead',
      url: '#88c0d0',
      fg: '#d8dee9',
      comment: '#616e88',
      error: '#bf616a',
    }),
    light: expand({
      keyword: '#5e81ac',
      func: '#0e7490',
      type: '#0f766e',
      type2: '#0f766e',
      attr: '#bf6b2e',
      title: '#8b5e8e',
      string: '#4f7a3a',
      number: '#8b5e8e',
      ref: '#8b5e8e',
      url: '#0e7490',
      fg: '#2e3440',
      comment: '#7b88a1',
      error: '#a3454c',
    }),
  },
};

/** The token colours for a theme id in the given mode, or null for the theme default (no family). */
export function themePalette(
  id: string,
  mode: 'light' | 'dark',
): Record<SyntaxToken, string> | null {
  return SYNTAX_THEMES[id]?.[mode] ?? null;
}
