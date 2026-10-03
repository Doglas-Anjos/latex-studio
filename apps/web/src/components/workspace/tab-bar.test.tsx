// @vitest-environment jsdom
import { act, cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { Container } from '../../di/container';
import { renderWithApp } from '../../test/render';
import { useWorkspaceStore } from '../../workspace-store';
import { TabBar } from './tab-bar';

describe('TabBar', () => {
  afterEach(() => {
    cleanup();
    useWorkspaceStore.setState({ tabs: [], activeTabId: null, activePath: null });
  });

  it('opens a tab per file and activates the neighbour on close', async () => {
    renderWithApp(<TabBar />, new Container());
    act(() => {
      useWorkspaceStore.getState().setActivePath('main.tex');
      useWorkspaceStore.getState().setActivePath('chapters/intro.tex');
    });
    expect(screen.getAllByRole('tab')).toHaveLength(2);
    expect(screen.getByRole('tab', { name: 'intro.tex' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Fechar intro.tex' }));
    expect(screen.getAllByRole('tab')).toHaveLength(1);
    expect(screen.getByRole('tab', { name: 'main.tex' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(useWorkspaceStore.getState().activePath).toBe('main.tex');
  });
});
