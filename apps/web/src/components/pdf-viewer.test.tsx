// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Container } from '../di/container';
import { type Build, type CompileService, CompileServiceToken } from '../services/compile.service';
import { renderWithApp } from '../test/render';
import { PdfViewer } from './pdf-viewer';

const pages = vi.hoisted(() =>
  [1, 2].map(() => ({
    getViewport: ({ scale }: { scale: number }) => ({ width: 100 * scale, height: 150 * scale }),
    render: () => ({ promise: Promise.resolve(), cancel: () => {} }),
    cleanup: vi.fn(),
  })),
);
vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {},
  getDocument: () => ({
    promise: Promise.resolve({
      numPages: 2,
      getPage: async (n: number) => pages[n - 1],
      loadingTask: { destroy: () => {} },
    }),
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

describe('PdfViewer pages', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('draws only pages near the viewport and frees the ones scrolled far away', async () => {
    let onEntries: (e: { target: Element; isIntersecting: boolean }[]) => void = () => {};
    let observed = 0;
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(cb: typeof onEntries) {
          onEntries = cb;
        }
        observe() {
          observed += 1;
        }
        disconnect() {}
      },
    );
    renderWithApp(
      <PdfViewer projectId="p1" />,
      new Container().register(CompileServiceToken, fake()),
    );
    // The observer is created in a passive effect after the pages render; under load the pages
    // can be in the DOM before it exists, so wait for it to watch them before firing entries.
    await waitFor(() => expect(observed).toBeGreaterThanOrEqual(2));
    const [p1, p2] = document.querySelectorAll('.pdf-page');
    await act(async () => {
      onEntries([
        { target: p1 as Element, isIntersecting: true },
        { target: p2 as Element, isIntersecting: false },
      ]);
    });
    await waitFor(() => expect(p1?.querySelector('canvas')).toBeTruthy());
    expect(p2?.querySelector('canvas')).toBeNull();
    await waitFor(() => expect(pages[1]?.cleanup).toHaveBeenCalled());
  });

  it('keeps the last good PDF after it drops out of the recent builds list', async () => {
    const failed = (id: string): Build => ({ ...build, id, status: 'failed' });
    const service = fake();
    service.builds = vi
      .fn()
      .mockResolvedValueOnce([{ ...build, id: 'b2', status: 'running' }, build])
      .mockResolvedValue(['f1', 'f2', 'f3', 'f4', 'f5'].map(failed));
    renderWithApp(
      <PdfViewer projectId="p1" />,
      new Container().register(CompileServiceToken, service),
    );
    await waitFor(() => expect(document.querySelectorAll('.pdf-page')).toHaveLength(2));
    await waitFor(() => expect(service.builds).toHaveBeenCalledTimes(2), { timeout: 3000 });
    expect(screen.queryByText('Compile o projeto para ver o PDF.')).toBeNull();
    expect(document.querySelectorAll('.pdf-page')).toHaveLength(2);
    expect(service.pdf).toHaveBeenCalledTimes(1);
  });
});
