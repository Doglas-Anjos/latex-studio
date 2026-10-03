// @vitest-environment jsdom
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Container } from '../di/container';
import { type HistoryService, HistoryServiceToken } from '../services/history.service';
import { renderWithApp } from '../test/render';
import { HistoryPanel } from './history-panel';

const author = { name: 'Ana', email: 'ana@example.com' };
const log = [
  { sha: 'b', message: 'Segunda versão', author, date: new Date().toISOString() },
  { sha: 'a', message: 'Primeira versão', author, date: new Date().toISOString() },
];

describe('HistoryPanel', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('lists commits and saves a version', async () => {
    const service: HistoryService = {
      log: vi.fn().mockResolvedValue(log),
      changes: vi.fn().mockResolvedValue([]),
      file: vi.fn(),
      commit: vi.fn().mockResolvedValue({ sha: 'c' }),
      restore: vi.fn(),
      status: vi.fn(),
      blame: vi.fn(),
    };
    vi.stubGlobal('prompt', vi.fn().mockReturnValue('Minha versão'));
    renderWithApp(
      <HistoryPanel projectId="p1" canEdit />,
      new Container().register(HistoryServiceToken, service),
    );
    expect(await screen.findByText('Segunda versão')).toBeTruthy();
    expect(screen.getByText('Primeira versão')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Salvar versão' }));
    await waitFor(() => expect(service.commit).toHaveBeenCalledWith('p1', 'Minha versão'));
  });
});
