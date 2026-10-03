// @vitest-environment jsdom
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Container } from '../../di/container';
import { type HistoryService, HistoryServiceToken } from '../../services/history.service';
import { renderWithApp } from '../../test/render';
import { useWorkspaceStore } from '../../workspace-store';
import { ChangesView } from './changes-view';

describe('ChangesView', () => {
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
});
