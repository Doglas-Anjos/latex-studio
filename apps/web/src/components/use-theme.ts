import { useEffect } from 'react';
import { resolveTheme, SYNTAX_TOKENS, useSettingsStore } from '../settings-store';
import { themePalette } from '../syntax-themes';

const setOrClear = (name: string, value: string | undefined) => {
  const style = document.documentElement.style;
  if (value) style.setProperty(name, value);
  else style.removeProperty(name);
};

/** Mirrors the settings store onto <html> (data-theme + CSS variables, via CSSOM). */
export function useApplyTheme() {
  const theme = useSettingsStore((s) => s.theme);
  const syntaxTheme = useSettingsStore((s) => s.syntaxTheme);
  const syntax = useSettingsStore((s) => s.syntax);
  const editorFont = useSettingsStore((s) => s.editorFont);
  const fontSize = useSettingsStore((s) => s.fontSize);

  // data-theme and the syntax colours are applied together: the resolved light/dark mode picks both
  // the base theme and which family palette applies, so a system change swaps both in one pass.
  // Precedence: a per-token override > the family's palette for this mode > the CSS default (cleared).
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const mode = resolveTheme(theme, mq.matches);
      document.documentElement.dataset.theme = mode;
      const palette = themePalette(syntaxTheme, mode);
      for (const { token } of SYNTAX_TOKENS)
        setOrClear(`--syn-${token}`, syntax[token] ?? palette?.[token]);
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme, syntaxTheme, syntax]);

  useEffect(() => {
    setOrClear('--editor-font', editorFont);
    setOrClear('--editor-font-size', `${fontSize}px`);
  }, [editorFont, fontSize]);
}
