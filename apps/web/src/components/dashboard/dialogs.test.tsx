// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Container } from '../../di/container';
import {
  type ImportInput,
  type Project,
  type ProjectService,
  ProjectServiceToken,
} from '../../services/project.service';
import { renderWithApp } from '../../test/render';
import { ImportDialog } from './dialogs';

const project: Project = {
  id: 'p1',
  ownerId: 'u',
  name: 'Tese',
  mainFile: 'main.tex',
  engine: 'pdflatex',
  createdAt: '',
  updatedAt: '',
  role: 'owner',
};

function setup() {
  const importMock = vi.fn().mockResolvedValue(project);
  const service = { import: importMock } as unknown as ProjectService;
  const dialogRef = createRef<HTMLDialogElement>();
  renderWithApp(
    <ImportDialog dialogRef={dialogRef} mode="zip" setMode={vi.fn()} onDone={vi.fn()} />,
    new Container().register(ProjectServiceToken, service),
  );
  dialogRef.current?.showModal();
  return importMock;
}

describe('ImportDialog', () => {
  beforeEach(() => {
    HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    });
  });
  afterEach(cleanup);

  it('imports a .zip file dropped on the dropzone', async () => {
    const importMock = setup();
    await userEvent.type(screen.getByLabelText('Nome'), 'Meu projeto');

    const zone = document.querySelector('.dropzone') as HTMLElement;
    const file = new File(['content'], 'project.zip', { type: 'application/zip' });
    fireEvent.drop(zone, { dataTransfer: { files: [file] } });
    expect(screen.getByText('project.zip')).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Importar' }));
    await waitFor(() => expect(importMock).toHaveBeenCalledTimes(1));
    const input = importMock.mock.calls[0]?.[0] as ImportInput;
    expect('archive' in input && input.archive.name).toBe('project.zip');
  });

  it('rejects a file dropped in zip mode that is not a .zip', () => {
    const importMock = setup();
    const zone = document.querySelector('.dropzone') as HTMLElement;
    const file = new File(['content'], 'notes.txt', { type: 'text/plain' });
    fireEvent.drop(zone, { dataTransfer: { files: [file] } });

    expect(screen.getByText('Selecione um arquivo .zip.')).toBeTruthy();
    expect(screen.queryByText('notes.txt')).toBeNull();
    expect(importMock).not.toHaveBeenCalled();
  });
});
