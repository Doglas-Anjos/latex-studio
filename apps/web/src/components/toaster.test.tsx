// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { toast, useToasts } from '../toast-store';
import { Toaster } from './toaster';

afterEach(() => {
  cleanup();
  useToasts.setState({ toasts: [] });
  for (const d of document.querySelectorAll('dialog')) d.remove();
});

it('shows a toast on the page, or inside the open dialog (outside it is inert)', () => {
  render(<Toaster />);
  act(() => toast('Falhou'));
  expect(screen.getByRole('alert').textContent).toBe('Falhou');
  expect(screen.getByRole('alert').closest('dialog')).toBeNull();

  const dialog = document.createElement('dialog');
  dialog.setAttribute('open', '');
  document.body.append(dialog);
  act(() => toast('Cota excedida'));
  const inside = screen.getAllByRole('alert').map((a) => a.closest('dialog'));
  expect(inside).toEqual([dialog, dialog]);

  fireEvent.click(screen.getAllByRole('button', { name: 'Fechar aviso' })[0] as HTMLElement);
  expect(screen.getAllByRole('alert')).toHaveLength(1);
});
