// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSettingsStore } from '../settings-store';
import { AppearanceDialog } from './appearance-dialog';

describe('AppearanceDialog', () => {
  afterEach(cleanup);

  it('imports JSON through a real, tabbable button instead of a label-wrapped input', async () => {
    const ref = createRef<HTMLDialogElement>();
    const { container } = render(<AppearanceDialog ref={ref} />);
    const button = screen.getByText('Importar JSON');
    expect(button.tagName).toBe('BUTTON');
    const input = container.querySelector('input[type="file"]');
    expect(input).toBeTruthy();
    const click = vi.fn();
    input?.addEventListener('click', click);
    await userEvent.click(button);
    expect(click).toHaveBeenCalledTimes(1);
  });

  it('previews every editor font in its own typeface and applies the one picked', async () => {
    render(<AppearanceDialog ref={createRef<HTMLDialogElement>()} />);
    const fira = screen.getByRole('radio', { name: /Fira Code/, hidden: true });
    const sample = fira.closest('label')?.querySelector<HTMLElement>('.font-sample');
    expect(sample?.style.fontFamily).toContain('Fira Code');
    expect(sample?.textContent).toContain(String.raw`\section{Introdução}`);
    expect(sample?.textContent).toContain(String.raw`$\alpha \neq`);
    await userEvent.click(fira);
    expect(useSettingsStore.getState().editorFont).toContain('Fira Code');
  });
});
