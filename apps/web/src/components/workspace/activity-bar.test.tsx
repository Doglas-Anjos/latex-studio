// @vitest-environment jsdom
import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Container } from '../../di/container';
import { type HistoryService, HistoryServiceToken } from '../../services/history.service';
import { useSettingsStore } from '../../settings-store';
import { renderWithApp } from '../../test/render';
import { ActivityBar } from './activity-bar';

describe('ActivityBar', () => {
  afterEach(cleanup);

  it('switches the sidebar view and shows the changes badge', async () => {
    const status = vi.fn().mockResolvedValue({
      baseline: null,
      changes: [{ path: 'a.tex', type: 'modify' }],
    });
    renderWithApp(
      <ActivityBar projectId="p1" />,
      new Container().register(HistoryServiceToken, { status } as unknown as HistoryService),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Mudanças' }));
    expect(useSettingsStore.getState().sidebarView).toBe('changes');
    expect(screen.getByRole('button', { name: 'Mudanças' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(await screen.findAllByText('1')).toHaveLength(2);
    expect(within(screen.getByRole('button', { name: 'Arquivos' })).getByText('1')).toBeTruthy();
  });
});
