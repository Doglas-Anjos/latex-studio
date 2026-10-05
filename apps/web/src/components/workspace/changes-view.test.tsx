// @vitest-environment jsdom
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Container } from '../../di/container';
import { type HistoryService, HistoryServiceToken } from '../../services/history.service';
import { useSettingsStore } from '../../settings-store';
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
    expect(screen.getByText('2 arquivos alterados')).toBeTruthy();
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

  it('groups changes by folder and lets the group collapse', async () => {
    const service = {
      status: vi.fn().mockResolvedValue({
        baseline: { sha: 'abc', message: 'base', date: new Date().toISOString() },
        changes: [
          { path: 'main.tex', type: 'modify' },
          { path: 'capitulos/intro.tex', type: 'add' },
          { path: 'capitulos/fim.tex', type: 'remove' },
        ],
      }),
    } as unknown as HistoryService;
    renderWithApp(
      <ChangesView projectId="p1" canEdit />,
      new Container().register(HistoryServiceToken, service),
    );
    expect(await screen.findByText('Raiz do projeto')).toBeTruthy();
    const folderHeader = screen.getByRole('button', { name: 'capitulos 2' });
    expect(screen.getByText('intro.tex')).toBeTruthy();
    expect(screen.getByText('fim.tex')).toBeTruthy();
    await userEvent.click(folderHeader);
    expect(screen.queryByText('intro.tex')).toBeNull();
    expect(screen.queryByText('fim.tex')).toBeNull();
  });

  it('shows loading, error and empty states', async () => {
    const status = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue({ baseline: null, changes: [] });
    const service = { status } as unknown as HistoryService;
    renderWithApp(
      <ChangesView projectId="p1" canEdit />,
      new Container().register(HistoryServiceToken, service),
    );
    expect(screen.getByText('Carregando mudanças…')).toBeTruthy();
    expect(await screen.findByText('Não foi possível carregar as mudanças.')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    expect(
      await screen.findByText(
        'Nenhuma mudança para salvar. Edite um arquivo para ver as alterações aqui.',
      ),
    ).toBeTruthy();
    expect(screen.getByText('Sem versão salva', { exact: false })).toBeTruthy();
  });

  it('opens the history panel from the header action', async () => {
    const service = {
      status: vi.fn().mockResolvedValue({
        baseline: { sha: 'abc', message: 'base', date: new Date().toISOString() },
        changes: [],
      }),
    } as unknown as HistoryService;
    renderWithApp(
      <ChangesView projectId="p1" canEdit />,
      new Container().register(HistoryServiceToken, service),
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Ver histórico' }));
    expect(useSettingsStore.getState().sidebarView).toBe('history');
  });
});
