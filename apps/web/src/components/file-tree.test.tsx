// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Container } from '../di/container';
import { type FileService, FileServiceToken } from '../services/file.service';
import { type HistoryService, HistoryServiceToken } from '../services/history.service';
import { useSettingsStore } from '../settings-store';
import { renderWithApp } from '../test/render';
import { useWorkspaceStore } from '../workspace-store';
import { buildTree, classifyFile, FileTree, uploadPath } from './file-tree';

const fake = (): FileService => ({
  list: vi.fn().mockResolvedValue([{ path: 'main.tex' }, { path: 'chapters/intro.tex' }]),
  download: vi.fn(),
  blob: vi.fn(),
  create: vi.fn(),
  createFolder: vi.fn().mockResolvedValue(undefined),
  remove: vi.fn().mockResolvedValue(undefined),
  rename: vi.fn().mockResolvedValue(undefined),
  upload: vi.fn().mockResolvedValue(undefined),
  write: vi.fn(),
});

const history = (changes: { path: string; type: string }[] = []) =>
  ({ status: vi.fn().mockResolvedValue({ baseline: null, changes }) }) as unknown as HistoryService;

describe('FileTree', () => {
  beforeEach(() => {
    HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    });
  });
  afterEach(() => {
    cleanup();
    useWorkspaceStore.setState({ activePath: null, pendingLine: null, historyScope: 'project' });
  });

  it('classifies files by extension', () => {
    expect(classifyFile('main.tex')).toBe('tex');
    expect(classifyFile('refs.bib')).toBe('bib');
    expect(classifyFile('thesis.cls')).toBe('style');
    expect(classifyFile('figure.PNG')).toBe('image');
    expect(classifyFile('paper.pdf')).toBe('pdf');
    expect(classifyFile('Makefile')).toBe('generic');
  });

  it('shows an empty folder from its placeholder without listing the placeholder', () => {
    const tree = buildTree([{ path: 'main.tex' }, { path: 'figs/.keep' }]);
    expect(tree.map((n) => n.name)).toEqual(['figs', 'main.tex']);
    expect(tree[0]?.children).toEqual([]);
  });

  it('puts folders first and nests files', () => {
    const tree = buildTree([{ path: 'main.tex' }, { path: 'chapters/intro.tex' }]);
    expect(tree.map((n) => n.name)).toEqual(['chapters', 'main.tex']);
    expect(tree[0]?.children?.[0]?.path).toBe('chapters/intro.tex');
  });

  it('shows the folder and activates a file on click', async () => {
    renderWithApp(
      <FileTree projectId="p1" canEdit={false} mainFile="main.tex" />,
      new Container().register(FileServiceToken, fake()).register(HistoryServiceToken, history()),
    );
    // First render of the file pays the cold imports; the default 1 s fails under the full suite.
    expect(await screen.findByRole('button', { name: /chapters/ }, { timeout: 5000 })).toBeTruthy();
    await userEvent.click(await screen.findByRole('button', { name: 'intro.tex' }));
    expect(useWorkspaceStore.getState().activePath).toBe('chapters/intro.tex');
  });

  it('opens the file history for a text file', async () => {
    renderWithApp(
      <FileTree projectId="p1" canEdit={false} mainFile="main.tex" />,
      new Container().register(FileServiceToken, fake()).register(HistoryServiceToken, history()),
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Histórico de main.tex' }));
    expect(useWorkspaceStore.getState().activePath).toBe('main.tex');
    expect(useWorkspaceStore.getState().historyScope).toBe('file');
    expect(useSettingsStore.getState().sidebarView).toBe('history');
  });

  it('prefills the rename dialog and rejects a path with ".."', async () => {
    const service = fake();
    renderWithApp(
      <FileTree projectId="p1" canEdit mainFile="main.tex" />,
      new Container().register(FileServiceToken, service).register(HistoryServiceToken, history()),
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
      new Container().register(FileServiceToken, service).register(HistoryServiceToken, history()),
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Excluir main.tex' }));
    const dialog = screen.getByRole('dialog', { name: 'Excluir' });
    expect(within(dialog).getByText(/não pode ser desfeita/)).toBeTruthy();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Excluir' }));
    expect(service.remove).toHaveBeenCalledWith('p1', 'main.tex');
  });

  it('closes tabs under a deleted folder and moves the open tab on rename', async () => {
    HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    });
    const store = useWorkspaceStore.getState();
    store.reset();
    store.setActivePath('main.tex');
    store.setActivePath('chapters/intro.tex');
    const service = fake();
    renderWithApp(
      <FileTree projectId="p1" canEdit mainFile="main.tex" />,
      new Container().register(FileServiceToken, service).register(HistoryServiceToken, history()),
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Excluir chapters' }));
    await userEvent.click(
      within(screen.getByRole('dialog', { name: 'Excluir' })).getByRole('button', {
        name: 'Excluir',
      }),
    );
    await waitFor(() =>
      expect(useWorkspaceStore.getState().tabs.map((t) => t.path)).toEqual(['main.tex']),
    );
    expect(useWorkspaceStore.getState().activePath).toBe('main.tex');

    await userEvent.click(screen.getByRole('button', { name: 'Renomear main.tex' }));
    const dialog = screen.getByRole('dialog', { name: 'Renomear' });
    const input = within(dialog).getByLabelText('Caminho');
    await userEvent.clear(input);
    await userEvent.type(input, 'tese.tex');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Renomear' }));
    await waitFor(() =>
      expect(useWorkspaceStore.getState().tabs.map((t) => t.path)).toEqual(['tese.tex']),
    );
    expect(useWorkspaceStore.getState().activePath).toBe('tese.tex');
  });

  it('uploads the files picked in the upload dialog and lets the user cancel one first', async () => {
    const service = fake();
    renderWithApp(
      <FileTree projectId="p1" canEdit mainFile="main.tex" />,
      new Container().register(FileServiceToken, service).register(HistoryServiceToken, history()),
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
    await waitFor(() =>
      expect(service.upload).toHaveBeenCalledWith('p1', [{ file: b, path: 'b.png' }]),
    );
  });

  it('uploads into the chosen folder and warns which existing files get replaced', async () => {
    const service = fake();
    renderWithApp(
      <FileTree projectId="p1" canEdit mainFile="main.tex" />,
      new Container().register(FileServiceToken, service).register(HistoryServiceToken, history()),
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Upload' }));
    const dialog = screen.getByRole('dialog', { name: 'Enviar arquivos' });
    await userEvent.click(within(dialog).getByRole('radio', { name: 'chapters' }));
    const intro = new File(['new intro'], 'intro.tex');
    const input = dialog.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [intro] } });
    const row = within(dialog).getByTitle('chapters/intro.tex').closest('li') as HTMLElement;
    expect(within(row).getByText('substitui')).toBeTruthy();
    expect(within(dialog).getByRole('status').textContent).toContain('todos substituem');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Enviar' }));
    await waitFor(() =>
      expect(service.upload).toHaveBeenCalledWith('p1', [
        { file: intro, path: 'chapters/intro.tex' },
      ]),
    );
  });

  it('creates a folder inside the chosen parent and refuses a name that already exists', async () => {
    const service = fake();
    renderWithApp(
      <FileTree projectId="p1" canEdit mainFile="main.tex" />,
      new Container().register(FileServiceToken, service).register(HistoryServiceToken, history()),
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Nova pasta' }));
    const dialog = screen.getByRole('dialog', { name: 'Nova pasta' });
    await userEvent.click(within(dialog).getByRole('radio', { name: 'chapters' }));
    const name = within(dialog).getByLabelText('Nome');
    await userEvent.type(name, 'intro.tex');
    expect(within(dialog).getByRole('alert').textContent).toContain('chapters/intro.tex');
    expect(within(dialog).getByRole('button', { name: 'Criar' })).toHaveProperty('disabled', true);
    await userEvent.clear(name);
    await userEvent.type(name, 'figs');
    expect(within(dialog).getByText('figs').closest('p')?.textContent).toBe('chapters/figs');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Criar' }));
    await waitFor(() => expect(service.createFolder).toHaveBeenCalledWith('p1', 'chapters/figs'));
  });

  it('reports after sending which files changed and which were identical', async () => {
    const service = fake();
    vi.mocked(service.upload).mockResolvedValue([
      { path: 'chapters/intro.tex', change: 'same' },
      { path: 'chapters/new.tex', change: 'add' },
    ]);
    renderWithApp(
      <FileTree projectId="p1" canEdit mainFile="main.tex" />,
      new Container().register(FileServiceToken, service).register(HistoryServiceToken, history()),
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Upload' }));
    const dialog = screen.getByRole('dialog', { name: 'Enviar arquivos' });
    const input = dialog.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['x'], 'intro.tex')] } });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Enviar' }));
    expect(
      await within(dialog).findByText('Envio concluído: 1 novo · 1 sem alterações'),
    ).toBeTruthy();
    expect(within(dialog).getByText(/idêntico, byte a byte/)).toBeTruthy();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Ver mudanças' }));
    expect(useSettingsStore.getState().sidebarView).toBe('changes');
  });

  it('keeps a picked folder name unless only its contents are sent', () => {
    const file = new File(['x'], 'fig.png');
    Object.defineProperty(file, 'webkitRelativePath', { value: 'tese/img/fig.png' });
    expect(uploadPath('', file)).toBe('tese/img/fig.png');
    expect(uploadPath('', file, true)).toBe('img/fig.png');
    expect(uploadPath('extra', file, true)).toBe('extra/img/fig.png');
    expect(uploadPath('extra', new File(['x'], 'a.tex'), true)).toBe('extra/a.tex');
  });

  it('marks changed files and their folders as dirty', async () => {
    const { container } = renderWithApp(
      <FileTree projectId="p1" canEdit={false} mainFile="main.tex" />,
      new Container().register(FileServiceToken, fake()).register(
        HistoryServiceToken,
        history([
          { path: 'chapters/intro.tex', type: 'modify' },
          { path: 'gone.tex', type: 'remove' },
        ]),
      ),
    );
    const badge = await screen.findByText('M');
    expect(badge.getAttribute('title')).toBe('Alterado desde a última versão salva');
    expect(badge.getAttribute('data-type')).toBe('modify');
    expect(container.querySelectorAll('.tree-dirty')).toHaveLength(2); // file + folder dot
  });
});
