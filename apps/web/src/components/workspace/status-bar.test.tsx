// @vitest-environment jsdom
import { cleanup, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Container } from '../../di/container';
import { type CompileService, CompileServiceToken } from '../../services/compile.service';
import { type HistoryService, HistoryServiceToken } from '../../services/history.service';
import { type ToolsService, ToolsServiceToken } from '../../services/tools.service';
import { renderWithApp } from '../../test/render';
import { StatusBar } from './status-bar';

const compile: CompileService = {
  compile: vi.fn(),
  builds: vi.fn().mockResolvedValue([]),
  pdf: vi.fn(),
  openLog: vi.fn(),
  downloadPdf: vi.fn(),
  cancel: vi.fn(),
};
const tools: ToolsService = {
  wordCount: vi.fn(),
  requestExport: vi.fn(),
  format: vi.fn(),
  jobStatus: vi.fn(),
  downloadJobFile: vi.fn(),
};

const ctrlS = () =>
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, cancelable: true }));
const EDITOR = 'editor' as const;
const VIEWER = 'viewer' as const;

describe('StatusBar Ctrl+S', () => {
  afterEach(() => cleanup());

  it('commits only the active file on Ctrl+S and shows a success note', async () => {
    const history = {
      commitFile: vi.fn().mockResolvedValue({ sha: 'abc' }),
    } as unknown as HistoryService;
    renderWithApp(
      <StatusBar projectId="p1" role={EDITOR} path="main.tex" />,
      new Container()
        .register(CompileServiceToken, compile)
        .register(ToolsServiceToken, tools)
        .register(HistoryServiceToken, history),
    );
    ctrlS();
    await waitFor(() => expect(history.commitFile).toHaveBeenCalledWith('p1', 'main.tex'));
    expect(await screen.findByText('Arquivo salvo')).toBeTruthy();
  });

  it('is a no-op for a read-only role and never calls the API', async () => {
    const history = { commitFile: vi.fn() } as unknown as HistoryService;
    renderWithApp(
      <StatusBar projectId="p1" role={VIEWER} path="main.tex" />,
      new Container()
        .register(CompileServiceToken, compile)
        .register(ToolsServiceToken, tools)
        .register(HistoryServiceToken, history),
    );
    ctrlS();
    expect(await screen.findByText('Somente leitura: nada para salvar')).toBeTruthy();
    expect(history.commitFile).not.toHaveBeenCalled();
  });

  it('shows a friendly note instead of an error when there is nothing to save', async () => {
    const history = {
      commitFile: vi.fn().mockRejectedValue(new Error('Nothing to commit')),
    } as unknown as HistoryService;
    renderWithApp(
      <StatusBar projectId="p1" role={EDITOR} path="main.tex" />,
      new Container()
        .register(CompileServiceToken, compile)
        .register(ToolsServiceToken, tools)
        .register(HistoryServiceToken, history),
    );
    ctrlS();
    expect(await screen.findByText('Nada para salvar')).toBeTruthy();
  });
});
