// @vitest-environment jsdom
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Container } from '../../di/container';
import { type HistoryService, HistoryServiceToken } from '../../services/history.service';
import { renderWithApp } from '../../test/render';
import { useWorkspaceStore } from '../../workspace-store';
import { ChangesView } from './changes-view';

describe('ChangesView', () => {
  beforeEach(() => {
    HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    });
    HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    });
  });
  afterEach(cleanup);

  it('lists changes, opens a diff tab and commits', async () => {
    const service = {
      status: vi.fn().mockResolvedValue({
        baseline: { sha: 'abc', message: 'base', date: new Date().toISOString() },
        changes: [
          { path: 'main.tex', type: 'modify' },
          { path: 'new.tex', type: 'add' },
        ],
      }),
      commit: vi.fn().mockResolvedValue({ sha: 'd' }),
    } as unknown as HistoryService;
    renderWithApp(
      <ChangesView projectId="p1" canEdit />,
      new Container().register(HistoryServiceToken, service),
    );
    expect(await screen.findByText('M')).toBeTruthy();
    expect(screen.getByText('A')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'main.tex' }));
    expect(useWorkspaceStore.getState().tabs).toContainEqual(
      expect.objectContaining({ kind: 'diff', path: 'main.tex', from: 'abc', to: 'work' }),
    );
    await userEvent.type(screen.getByLabelText('Mensagem da versão'), 'nova');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar versão' }));
    await waitFor(() => expect(service.commit).toHaveBeenCalledWith('p1', 'nova'));
  });

  it('asks for confirmation before discarding changes, and cancel keeps them', async () => {
    const service = {
      status: vi.fn().mockResolvedValue({
        baseline: { sha: 'abc', message: 'base', date: new Date().toISOString() },
        changes: [{ path: 'main.tex', type: 'modify' }],
      }),
      restore: vi.fn().mockResolvedValue(undefined),
    } as unknown as HistoryService;
    renderWithApp(
      <ChangesView projectId="p1" canEdit />,
      new Container().register(HistoryServiceToken, service),
    );
    await userEvent.click(
      await screen.findByRole('button', { name: 'Descartar alterações de main.tex' }),
    );
    const confirmDialog = screen.getByRole('dialog', { name: 'Descartar alterações' });
    expect(within(confirmDialog).getByText(/main\.tex/)).toBeTruthy();
    await userEvent.click(within(confirmDialog).getByRole('button', { name: 'Cancelar' }));
    expect(service.restore).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Descartar alterações de main.tex' }));
    await userEvent.click(within(confirmDialog).getByRole('button', { name: 'Descartar' }));
    await waitFor(() => expect(service.restore).toHaveBeenCalledWith('p1', 'abc', 'main.tex'));
  });
});
