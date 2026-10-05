// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Container } from '../di/container';
import { type Build, type CompileService, CompileServiceToken } from '../services/compile.service';
import { renderWithApp } from '../test/render';
import { PdfViewer } from './pdf-viewer';

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {},
  getDocument: () => ({
    promise: Promise.resolve({ numPages: 0, loadingTask: { destroy: vi.fn() } }),
  }),
}));

const build: Build = {
  id: 'b1',
  projectId: 'p1',
  status: 'succeeded',
  engine: 'pdflatex',
  mainFile: 'main.tex',
  commitSha: null,
  exitCode: 0,
  errors: [],
  warnings: [],
  createdAt: new Date().toISOString(),
  startedAt: null,
  finishedAt: null,
};

const fake = (): CompileService => ({
  compile: vi.fn(),
  builds: vi.fn().mockResolvedValue([build]),
  pdf: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
  openLog: vi.fn(),
  downloadPdf: vi.fn(),
  cancel: vi.fn(),
});

describe('PdfViewer zoom', () => {
  afterEach(() => cleanup());

  it('starts at 100% and shows ctrl+wheel/button zoom, clamped and resettable', async () => {
    renderWithApp(
      <PdfViewer projectId="p1" />,
      new Container().register(CompileServiceToken, fake()),
    );

    const group = await screen.findByRole('group', { name: 'Zoom' });
    expect(within(group).getByText('100%')).toBeTruthy();

    const body = document.querySelector('.pdf-viewer-body') as HTMLElement;
    const scrolled = fireEvent.wheel(body, { deltaY: -200, ctrlKey: true });
    expect(scrolled).toBe(false); // preventDefault suppresses the browser's own page zoom
    expect(await screen.findByText(/^(?!100%).+%$/)).toBeTruthy();

    // Plain wheel scrolling (no ctrl) must not change the zoom level.
    const before = screen.getByRole('group', { name: 'Zoom' }).textContent;
    fireEvent.wheel(body, { deltaY: -200, ctrlKey: false });
    expect(screen.getByRole('group', { name: 'Zoom' }).textContent).toBe(before);

    await userEvent.click(screen.getByRole('button', { name: /clique para restaurar/ }));
    expect(screen.getByText('100%')).toBeTruthy();

    for (let i = 0; i < 40; i++) {
      await userEvent.click(screen.getByRole('button', { name: 'Diminuir zoom' }));
    }
    expect(screen.getByText('50%')).toBeTruthy();
  });
});
