import { Languages } from 'lucide-react';
import { UI_LANGS } from '../i18n';
import { type UiLang, useSettingsStore } from '../settings-store';
import { Menu } from './menu';

const SHORT: Record<'' | UiLang, string> = { '': 'Auto', 'pt-BR': 'PT', en: 'EN', es: 'ES' };
const OPTIONS: Array<{ value: '' | UiLang; label: string }> = [
  { value: '', label: 'Automático' },
  ...UI_LANGS,
];

/** Header language switcher for the nav menu (the Settings dialog has the same choice). */
export function LanguageToggle() {
  const uiLang = useSettingsStore((s) => s.uiLang);
  const set = useSettingsStore((s) => s.set);
  return (
    <Menu
      className="lang-menu"
      triggerClassName="btn btn-ghost btn-compact"
      label={
        <>
          <Languages size={16} aria-hidden="true" />
          <span className="sr-only">Idioma da interface</span>
          {SHORT[uiLang]}
        </>
      }
    >
      {OPTIONS.map((o) => (
        <button
          key={o.value || 'auto'}
          type="button"
          aria-pressed={uiLang === o.value}
          onClick={() => set({ uiLang: o.value })}
        >
          {o.label}
        </button>
      ))}
    </Menu>
  );
}
