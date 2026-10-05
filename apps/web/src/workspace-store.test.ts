import { beforeEach, describe, expect, it } from 'vitest';
import { useWorkspaceStore } from './workspace-store';

const s = () => useWorkspaceStore.getState();

describe('workspace store', () => {
  beforeEach(() => s().reset());

  it('closes tabs on a deleted file or folder and activates a survivor', () => {
    s().setActivePath('main.tex');
    s().setActivePath('ch/a.tex');
    s().openTab({ kind: 'diff', path: 'ch/b.tex', from: 'x', to: 'work' });
    s().setActivePath('ch/a.tex');
    s().closeTabsUnder('ch');
    expect(s().tabs.map((t) => t.path)).toEqual(['main.tex']);
    expect(s().activeTabId).toBe('file:main.tex');
    expect(s().activePath).toBe('main.tex');
    // "ch" must not match a sibling sharing the prefix.
    s().setActivePath('chapter.tex');
    s().closeTabsUnder('ch');
    expect(s().tabs).toHaveLength(2);
  });

  it('reset drops tabs and per-project state', () => {
    s().setActivePath('main.tex');
    s().bumpDocVersion();
    s().reset();
    expect(s().tabs).toEqual([]);
    expect(s().activePath).toBeNull();
    expect(s().docVersion).toBe(0);
  });
});
