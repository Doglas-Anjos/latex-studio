// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
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

  it('navigates and activates tabs with the arrow keys', async () => {
    renderWithApp(<TabBar />, new Container());
    act(() => {
      useWorkspaceStore.getState().setActivePath('main.tex');
      useWorkspaceStore.getState().setActivePath('chapters/intro.tex');
    });
    screen.getByRole('tab', { name: 'intro.tex' }).focus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(screen.getByRole('tab', { name: 'main.tex' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'main.tex' }));
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'intro.tex' }).getAttribute('aria-selected')).toBe(
      'true',
    );
  });

  it('prevents the browser middle-click autoscroll and closes on auxclick', () => {
    renderWithApp(<TabBar />, new Container());
    act(() => useWorkspaceStore.getState().setActivePath('main.tex'));
    const tab = screen.getByRole('tab', { name: 'main.tex' }).closest('.tab');
    if (!tab) throw new Error('tab wrapper not found');
    const mouseDown = new MouseEvent('mousedown', { button: 1, bubbles: true, cancelable: true });
    tab.dispatchEvent(mouseDown);
    expect(mouseDown.defaultPrevented).toBe(true);
    fireEvent(tab, new MouseEvent('auxclick', { button: 1, bubbles: true, cancelable: true }));
    expect(screen.queryByRole('tab')).toBeNull();
  });

  it('shows a diff icon distinct from the file icon for diff tabs', () => {
    renderWithApp(<TabBar />, new Container());
    act(() => {
      useWorkspaceStore.getState().setActivePath('main.tex');
      useWorkspaceStore
        .getState()
        .openTab({ kind: 'diff', path: 'main.tex', from: 'empty', to: 'work' });
    });
    const tabs = screen.getAllByRole('tab', { name: 'main.tex' });
    expect(tabs).toHaveLength(2);
    expect(tabs[0]?.querySelector('.file-icon-diff')).toBeNull();
    expect(tabs[1]?.querySelector('.file-icon-diff')).not.toBeNull();
  });
});
