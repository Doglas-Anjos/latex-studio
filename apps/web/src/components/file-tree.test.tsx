// @vitest-environment jsdom
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Container } from '../di/container';
import { type FileService, FileServiceToken } from '../services/file.service';
import { renderWithApp } from '../test/render';
import { useWorkspaceStore } from '../workspace-store';
import { buildTree, FileTree } from './file-tree';

const fake = (): FileService => ({
  list: vi.fn().mockResolvedValue([{ path: 'main.tex' }, { path: 'chapters/intro.tex' }]),
  download: vi.fn(),
  blob: vi.fn(),
  create: vi.fn(),
  createFolder: vi.fn(),
  remove: vi.fn(),
  rename: vi.fn(),
  upload: vi.fn(),
  write: vi.fn(),
});

describe('FileTree', () => {
  afterEach(() => {
    cleanup();
    useWorkspaceStore.setState({ activePath: null, pendingLine: null });
  });

  it('puts folders first and nests files', () => {
    const tree = buildTree([{ path: 'main.tex' }, { path: 'chapters/intro.tex' }]);
    expect(tree.map((n) => n.name)).toEqual(['chapters', 'main.tex']);
    expect(tree[0]?.children?.[0]?.path).toBe('chapters/intro.tex');
  });

  it('shows the folder and activates a file on click', async () => {
    renderWithApp(
      <FileTree projectId="p1" canEdit={false} mainFile="main.tex" />,
      new Container().register(FileServiceToken, fake()),
    );
    expect(await screen.findByRole('button', { name: /chapters/ })).toBeTruthy();
    await userEvent.click(await screen.findByRole('button', { name: /intro\.tex/ }));
    expect(useWorkspaceStore.getState().activePath).toBe('chapters/intro.tex');
  });
});
