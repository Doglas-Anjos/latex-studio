// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Container } from '../di/container';
import { type FileService, FileServiceToken } from '../services/file.service';
import { renderWithApp } from '../test/render';
import { useWorkspaceStore } from '../workspace-store';
import { buildTree, classifyFile, FileTree } from './file-tree';

const fake = (): FileService => ({
  list: vi.fn().mockResolvedValue([{ path: 'main.tex' }, { path: 'chapters/intro.tex' }]),
  download: vi.fn(),
  blob: vi.fn(),
  create: vi.fn(),
  createFolder: vi.fn(),
  remove: vi.fn().mockResolvedValue(undefined),
  rename: vi.fn().mockResolvedValue(undefined),
  upload: vi.fn().mockResolvedValue(undefined),
  write: vi.fn(),
});

describe('FileTree', () => {
  beforeEach(() => {
    HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    });
  });
  afterEach(() => {
    cleanup();
    useWorkspaceStore.setState({ activePath: null, pendingLine: null });
  });

  it('classifies files by extension', () => {
    expect(classifyFile('main.tex')).toBe('tex');
    expect(classifyFile('refs.bib')).toBe('bib');
    expect(classifyFile('thesis.cls')).toBe('style');
    expect(classifyFile('figure.PNG')).toBe('image');
    expect(classifyFile('paper.pdf')).toBe('pdf');
    expect(classifyFile('Makefile')).toBe('generic');
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

  it('prefills the rename dialog and rejects a path with ".."', async () => {
    const service = fake();
    renderWithApp(
      <FileTree projectId="p1" canEdit mainFile="main.tex" />,
      new Container().register(FileServiceToken, service),
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Renomear main.tex' }));
    const dialog = screen.getByRole('dialog', { name: 'Renomear' });
    const input = within(dialog).getByLabelText('Caminho') as HTMLInputElement;
    expect(input.value).toBe('main.tex');

    await userEvent.clear(input);
    await userEvent.type(input, '../main.tex');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Renomear' }));
    expect(within(dialog).getByRole('alert').textContent).toContain('..');
    expect(service.rename).not.toHaveBeenCalled();
  });

  it('asks for confirmation before deleting and calls the API on confirm', async () => {
    const service = fake();
    renderWithApp(
      <FileTree projectId="p1" canEdit mainFile="main.tex" />,
      new Container().register(FileServiceToken, service),
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Excluir main.tex' }));
    const dialog = screen.getByRole('dialog', { name: 'Excluir' });
    expect(within(dialog).getByText(/não pode ser desfeita/)).toBeTruthy();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Excluir' }));
    expect(service.remove).toHaveBeenCalledWith('p1', 'main.tex');
  });

  it('uploads the files picked in the upload dialog and lets the user cancel one first', async () => {
    const service = fake();
    renderWithApp(
      <FileTree projectId="p1" canEdit mainFile="main.tex" />,
      new Container().register(FileServiceToken, service),
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Upload' }));
    const dialog = screen.getByRole('dialog', { name: 'Enviar arquivos' });
    const input = dialog.querySelector('input[type="file"]') as HTMLInputElement;

    const a = new File(['a'], 'a.png', { type: 'image/png' });
    const b = new File(['b'], 'b.png', { type: 'image/png' });
    fireEvent.change(input, { target: { files: [a, b] } });
    expect(within(dialog).getByText('a.png')).toBeTruthy();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Remover a.png' }));
    expect(within(dialog).queryByText('a.png')).toBeNull();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Enviar' }));
    await waitFor(() => expect(service.upload).toHaveBeenCalledWith('p1', [b]));
  });
});
