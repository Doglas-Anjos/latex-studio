// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSettingsStore } from '../settings-store';
import { SettingsDialog } from './settings-dialog';

describe('SettingsDialog', () => {
  afterEach(cleanup);

  it('switches to Compilação and toggles a compile setting on the store', async () => {
    const before = useSettingsStore.getState().autoCompile;
    render(<SettingsDialog ref={createRef<HTMLDialogElement>()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Compilação', hidden: true }));
    await userEvent.click(screen.getByLabelText('Compilação automática'));
    expect(useSettingsStore.getState().autoCompile).toBe(!before);
  });

  it('imports JSON through a real button under Aparência', async () => {
    const ref = createRef<HTMLDialogElement>();
    const { container } = render(<SettingsDialog ref={ref} />);
    await userEvent.click(screen.getByRole('button', { name: 'Aparência', hidden: true }));
    const button = screen.getByText('Importar JSON');
    expect(button.tagName).toBe('BUTTON');
    const input = container.querySelector('input[type="file"]');
    expect(input).toBeTruthy();
    const click = vi.fn();
    input?.addEventListener('click', click);
    await userEvent.click(button);
    expect(click).toHaveBeenCalledTimes(1);
  });

  it('previews every editor font and applies the one picked', async () => {
    render(<SettingsDialog ref={createRef<HTMLDialogElement>()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Aparência', hidden: true }));
    const fira = screen.getByRole('radio', { name: /Fira Code/, hidden: true });
    const sample = fira.closest('label')?.querySelector<HTMLElement>('.font-sample');
    expect(sample?.style.fontFamily).toContain('Fira Code');
    expect(sample?.textContent).toContain(String.raw`\section{Introdução}`);
    await userEvent.click(fira);
    expect(useSettingsStore.getState().editorFont).toContain('Fira Code');
  });
});
