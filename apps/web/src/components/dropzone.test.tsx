// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Dropzone } from './dropzone';

function Harness({ multiple = false }: { multiple?: boolean }) {
  const [files, setFiles] = useState<File[]>([]);
  return (
    <Dropzone
      accept=".zip"
      multiple={multiple}
      label="Arraste o arquivo aqui"
      browseLabel="Selecionar arquivo"
      files={files}
      onFiles={setFiles}
    />
  );
}

describe('Dropzone', () => {
  afterEach(cleanup);

  it('accepts a dropped .zip file and shows its name', () => {
    const { container } = render(<Harness />);
    const zone = container.querySelector('.dropzone') as HTMLElement;
    const file = new File(['content'], 'project.zip', { type: 'application/zip' });
    fireEvent.drop(zone, { dataTransfer: { files: [file] } });
    expect(screen.getByText('project.zip')).toBeTruthy();
  });

  it('lets the user cancel a selected file', async () => {
    const { container } = render(<Harness multiple />);
    const zone = container.querySelector('.dropzone') as HTMLElement;
    fireEvent.drop(zone, {
      dataTransfer: {
        files: [
          new File(['a'], 'a.tex', { type: 'text/plain' }),
          new File(['b'], 'b.tex', { type: 'text/plain' }),
        ],
      },
    });
    expect(screen.getByText('a.tex')).toBeTruthy();
    expect(screen.getByText('b.tex')).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Remover a.tex' }));
    expect(screen.queryByText('a.tex')).toBeNull();
    expect(screen.getByText('b.tex')).toBeTruthy();
  });

  it('opens the native picker from the browse button', async () => {
    const { container } = render(<Harness />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const click = vi.fn();
    input.addEventListener('click', click);
    await userEvent.click(screen.getByRole('button', { name: 'Selecionar arquivo' }));
    expect(click).toHaveBeenCalledTimes(1);
  });
});
