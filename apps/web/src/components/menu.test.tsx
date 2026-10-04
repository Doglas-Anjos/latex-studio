// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { Menu } from './menu';

describe('Menu', () => {
  afterEach(cleanup);

  it('closes on item click and keeps open when the item is disabled', async () => {
    const user = userEvent.setup();
    render(
      <Menu label="Opções">
        <button type="button" disabled>
          Indisponível
        </button>
        <button type="button">Exportar</button>
      </Menu>,
    );
    const summary = screen.getByText('Opções');
    const details = summary.closest('details') as HTMLDetailsElement;
    await user.click(summary);
    expect(details.open).toBe(true);

    await user.click(screen.getByText('Indisponível'));
    expect(details.open).toBe(true);

    await user.click(screen.getByText('Exportar'));
    expect(details.open).toBe(false);
  });

  it('closes on keyboard selection, and Escape returns focus to the trigger', async () => {
    const user = userEvent.setup();
    render(
      <Menu label="Opções">
        <button type="button">Exportar</button>
      </Menu>,
    );
    const summary = screen.getByText('Opções');
    const details = summary.closest('details') as HTMLDetailsElement;
    await user.click(summary);
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Exportar' }));
    await user.keyboard('{Enter}');
    expect(details.open).toBe(false);

    await user.click(summary);
    await user.keyboard('{Escape}');
    expect(details.open).toBe(false);
    expect(document.activeElement).toBe(summary);
  });

  it('closes on an outside click', async () => {
    const user = userEvent.setup();
    render(
      <Menu label="Opções">
        <button type="button">Exportar</button>
      </Menu>,
    );
    const summary = screen.getByText('Opções');
    const details = summary.closest('details') as HTMLDetailsElement;
    await user.click(summary);
    expect(details.open).toBe(true);

    await user.click(document.body);
    expect(details.open).toBe(false);
  });
});
