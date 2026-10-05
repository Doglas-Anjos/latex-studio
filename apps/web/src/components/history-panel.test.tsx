// @vitest-environment jsdom
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Container } from '../di/container';
import { type HistoryService, HistoryServiceToken } from '../services/history.service';
import { renderWithApp } from '../test/render';
import { useWorkspaceStore } from '../workspace-store';
import { HistoryPanel } from './history-panel';

const author = { name: 'Ana', email: 'ana@example.com' };
const log = [
  { sha: 'b', message: 'Segunda versão', author, date: new Date().toISOString() },
  { sha: 'a', message: 'Primeira versão', author, date: new Date().toISOString() },
];

describe('HistoryPanel', () => {
  beforeEach(() => {
    HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    });
    HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    });
  });
  afterEach(() => {
    cleanup();
    useWorkspaceStore.setState({ historyScope: 'project' });
    vi.unstubAllGlobals();
  });

  it('lists commits and saves a version', async () => {
    const service: HistoryService = {
      log: vi.fn().mockResolvedValue(log),
      fileLog: vi.fn().mockResolvedValue([]),
      changes: vi.fn().mockResolvedValue([]),
      file: vi.fn(),
      commit: vi.fn().mockResolvedValue({ sha: 'c' }),
      commitFile: vi.fn(),
      restore: vi.fn(),
      status: vi.fn(),
      blame: vi.fn(),
    };
    renderWithApp(
      <HistoryPanel projectId="p1" canEdit path="main.tex" />,
      new Container().register(HistoryServiceToken, service),
    );
    expect(await screen.findByText('Segunda versão')).toBeTruthy();
    expect(screen.getByText('Primeira versão')).toBeTruthy();
    await userEvent.type(screen.getByLabelText('Mensagem da versão'), 'Minha versão');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar versão' }));
    await waitFor(() => expect(service.commit).toHaveBeenCalledWith('p1', 'Minha versão'));
  });

  it('collapses 3+ consecutive autosaves into one expandable row', async () => {
    const auto = (sha: string) => ({
      sha,
      message: 'Autosave',
      author,
      date: new Date().toISOString(),
    });
    const service = {
      log: vi.fn().mockResolvedValue([log[0], auto('x3'), auto('x2'), auto('x1'), log[1]]),
      fileLog: vi.fn().mockResolvedValue([]),
      changes: vi.fn().mockResolvedValue([]),
    } as unknown as HistoryService;
    renderWithApp(
      <HistoryPanel projectId="p1" canEdit path="main.tex" />,
      new Container().register(HistoryServiceToken, service),
    );
    const summary = await screen.findByText('3 salvamentos automáticos');
    expect((summary.closest('details') as HTMLDetailsElement).open).toBe(false);
    await userEvent.click(summary);
    expect((summary.closest('details') as HTMLDetailsElement).open).toBe(true);
    expect(screen.getByText('Segunda versão')).toBeTruthy();
  });

  it('asks for confirmation before restoring a file, and cancel keeps it unchanged', async () => {
    const service: HistoryService = {
      log: vi.fn().mockResolvedValue(log),
      fileLog: vi.fn().mockResolvedValue([]),
      changes: vi.fn().mockResolvedValue([{ path: 'main.tex', type: 'modify' }]),
      file: vi.fn(),
      commit: vi.fn(),
      commitFile: vi.fn(),
      restore: vi.fn().mockResolvedValue(undefined),
      status: vi.fn(),
      blame: vi.fn(),
    };
    renderWithApp(
      <HistoryPanel projectId="p1" canEdit path="main.tex" />,
      new Container().register(HistoryServiceToken, service),
    );
    await userEvent.click(await screen.findByText('Segunda versão'));
    await userEvent.click(await screen.findByRole('button', { name: 'restaurar' }));
    const confirmDialog = screen.getByRole('dialog', { name: 'Restaurar arquivo' });
    expect(within(confirmDialog).getByText(/main\.tex/)).toBeTruthy();
    await userEvent.click(within(confirmDialog).getByRole('button', { name: 'Cancelar' }));
    expect(service.restore).not.toHaveBeenCalled();
    await userEvent.click(await screen.findByRole('button', { name: 'restaurar' }));
    await userEvent.click(within(confirmDialog).getByRole('button', { name: 'Restaurar' }));
    await waitFor(() => expect(service.restore).toHaveBeenCalledWith('p1', 'b', 'main.tex'));
  });

  it('opens diff tabs when comparing with the previous commit', async () => {
    const service = {
      log: vi.fn().mockResolvedValue(log),
      fileLog: vi.fn().mockResolvedValue([]),
      changes: vi.fn().mockResolvedValue([{ path: 'main.tex', type: 'modify' }]),
    } as unknown as HistoryService;
    renderWithApp(
      <HistoryPanel projectId="p1" canEdit path="main.tex" />,
      new Container().register(HistoryServiceToken, service),
    );
    await screen.findByText('Segunda versão');
    await userEvent.click(
      screen.getAllByRole('button', { name: /Comparar com anterior/ })[0] as HTMLElement,
    );
    await waitFor(() => expect(service.changes).toHaveBeenCalledWith('p1', 'a', 'b'));
    await waitFor(() =>
      expect(useWorkspaceStore.getState().tabs).toContainEqual(
        expect.objectContaining({ kind: 'diff', path: 'main.tex', from: 'a', to: 'b' }),
      ),
    );
  });

  describe('file scope', () => {
    const fileLog = [
      { sha: 'y', message: 'Update main.tex', author, date: new Date().toISOString() },
      { sha: 'x', message: 'v1', author, date: new Date().toISOString() },
    ];

    it('shows unsaved changes and the commits that touched the active file', async () => {
      const service = {
        log: vi.fn().mockResolvedValue(log),
        fileLog: vi.fn().mockResolvedValue(fileLog),
        changes: vi.fn().mockResolvedValue([]),
        status: vi.fn().mockResolvedValue({
          baseline: { sha: 'y', message: 'Update main.tex', date: new Date().toISOString() },
          changes: [{ path: 'main.tex', type: 'modify' }],
        }),
      } as unknown as HistoryService;
      renderWithApp(
        <HistoryPanel projectId="p1" canEdit path="main.tex" />,
        new Container().register(HistoryServiceToken, service),
      );
      await userEvent.click(screen.getByRole('button', { name: 'Arquivo atual' }));
      expect(await screen.findByText('Alterações não salvas.')).toBeTruthy();
      expect(await screen.findByText('v1')).toBeTruthy();
      expect(screen.getByText('Update main.tex')).toBeTruthy();
      await waitFor(() => expect(service.fileLog).toHaveBeenCalledWith('p1', 'main.tex'));
    });

    it('opens a diff against the current draft and against the adjacent revision', async () => {
      const service = {
        log: vi.fn().mockResolvedValue(log),
        fileLog: vi.fn().mockResolvedValue(fileLog),
        changes: vi.fn().mockResolvedValue([]),
        status: vi.fn().mockResolvedValue({ baseline: null, changes: [] }),
      } as unknown as HistoryService;
      renderWithApp(
        <HistoryPanel projectId="p1" canEdit path="main.tex" />,
        new Container().register(HistoryServiceToken, service),
      );
      await userEvent.click(screen.getByRole('button', { name: 'Arquivo atual' }));
      await screen.findByText('v1');

      await userEvent.click(
        screen.getAllByRole('button', { name: /Comparar com atual/ })[0] as HTMLElement,
      );
      await waitFor(() =>
        expect(useWorkspaceStore.getState().tabs).toContainEqual(
          expect.objectContaining({ kind: 'diff', path: 'main.tex', from: 'y', to: 'work' }),
        ),
      );

      await userEvent.click(
        screen.getAllByRole('button', { name: /Comparar com anterior/ })[0] as HTMLElement,
      );
      await waitFor(() =>
        expect(useWorkspaceStore.getState().tabs).toContainEqual(
          expect.objectContaining({ kind: 'diff', path: 'main.tex', from: 'x', to: 'y' }),
        ),
      );
    });
  });
});
