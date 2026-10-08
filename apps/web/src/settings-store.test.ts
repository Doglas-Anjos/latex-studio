// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { resolveTheme, useSettingsStore } from './settings-store';

describe('settings store', () => {
  beforeEach(() => {
    localStorage.clear();
    useSettingsStore.getState().reset();
  });

  it.each([
    ['light', true, 'light'],
    ['dark', false, 'dark'],
    ['system', true, 'dark'],
    ['system', false, 'light'],
  ] as const)('resolveTheme(%s, %s) = %s', (t, dark, out) => {
    expect(resolveTheme(t, dark)).toBe(out);
  });

  it('persists and rehydrates', async () => {
    useSettingsStore.getState().set({ theme: 'dark' });
    const saved = JSON.parse(localStorage.getItem('latex-studio.settings') ?? '{}');
    expect(saved.state.theme).toBe('dark');
    useSettingsStore.setState({ theme: 'light' }); // also persists, so restore the saved blob
    localStorage.setItem('latex-studio.settings', JSON.stringify(saved));
    await useSettingsStore.persist.rehydrate();
    expect(useSettingsStore.getState().theme).toBe('dark');
  });

  it('migrates a v1 blob to stopOnFirstError off, keeping other fields', async () => {
    const v1 = { state: { theme: 'dark', stopOnFirstError: true }, version: 1 };
    localStorage.setItem('latex-studio.settings', JSON.stringify(v1));
    await useSettingsStore.persist.rehydrate();
    expect(useSettingsStore.getState().stopOnFirstError).toBe(false);
    expect(useSettingsStore.getState().theme).toBe('dark');
  });

  it('reset restores defaults', () => {
    useSettingsStore.getState().set({ theme: 'dark', fontSize: 20, syntax: { math: '#fff' } });
    useSettingsStore.getState().reset();
    const s = useSettingsStore.getState();
    expect([s.theme, s.fontSize, s.syntax]).toEqual(['system', 14, {}]);
  });
});
