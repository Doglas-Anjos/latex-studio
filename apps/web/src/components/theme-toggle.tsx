import { Laptop, Moon, Sun } from 'lucide-react';
import { type ThemeSetting, useSettingsStore } from '../settings-store';
import { Button } from './button';

const next: Record<ThemeSetting, ThemeSetting> = { light: 'dark', dark: 'system', system: 'light' };
const meta = {
  light: { Icon: Sun, label: 'claro' },
  dark: { Icon: Moon, label: 'escuro' },
  system: { Icon: Laptop, label: 'sistema' },
};

export function ThemeToggle() {
  const theme = useSettingsStore((s) => s.theme);
  const set = useSettingsStore((s) => s.set);
  const { Icon, label } = meta[theme];
  const text = `Tema: ${label}`;
  return (
    <Button
      variant="ghost"
      aria-label={text}
      title={text}
      onClick={() => set({ theme: next[theme] })}
    >
      <Icon size={18} aria-hidden="true" />
    </Button>
  );
}
