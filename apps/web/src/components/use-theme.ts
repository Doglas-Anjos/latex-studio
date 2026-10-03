import { useEffect } from 'react';
import { resolveTheme, SYNTAX_TOKENS, useSettingsStore } from '../settings-store';

const setOrClear = (name: string, value: string | undefined) => {
  const style = document.documentElement.style;
  if (value) style.setProperty(name, value);
  else style.removeProperty(name);
};

/** Mirrors the settings store onto <html> (data-theme + CSS variables, via CSSOM). */
export function useApplyTheme() {
  const theme = useSettingsStore((s) => s.theme);
  const syntax = useSettingsStore((s) => s.syntax);
  const editorFont = useSettingsStore((s) => s.editorFont);
  const fontSize = useSettingsStore((s) => s.fontSize);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      document.documentElement.dataset.theme = resolveTheme(theme, mq.matches);
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);

  useEffect(() => {
    for (const { token } of SYNTAX_TOKENS) setOrClear(`--syn-${token}`, syntax[token]);
  }, [syntax]);

  useEffect(() => {
    setOrClear('--editor-font', editorFont);
    setOrClear('--editor-font-size', `${fontSize}px`);
  }, [editorFont, fontSize]);
}
