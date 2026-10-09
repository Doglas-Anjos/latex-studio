// @vitest-environment jsdom
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { Container } from '../di/container';
import { type Build, type CompileService, CompileServiceToken } from '../services/compile.service';
import { type ProjectService, ProjectServiceToken } from '../services/project.service';
import { type ToolsService, ToolsServiceToken } from '../services/tools.service';
import { renderWithApp } from '../test/render';
import { DownloadButton } from './download-button';

const succeeded: Build = {
  id: 'b1',
  projectId: 'p1',
  status: 'succeeded',
  engine: 'pdflatex',
  mainFile: 'main.tex',
  commitSha: null,
  exitCode: 0,
  errors: [],
  warnings: [],
  createdAt: '',
  startedAt: null,
  finishedAt: null,
};

function setup(builds: Build[], canEdit = true, tools = {} as unknown as ToolsService) {
  const compile = {
    builds: vi.fn().mockResolvedValue(builds),
    downloadPdf: vi.fn(),
  } as unknown as CompileService;
  const projects = { downloadSource: vi.fn() } as unknown as ProjectService;
  const { container } = renderWithApp(
    <DownloadButton projectId="p1" canEdit={canEdit} />,
    new Container()
      .register(CompileServiceToken, compile)
      .register(ProjectServiceToken, projects)
      .register(ToolsServiceToken, tools),
  );
  return { compile, projects, container };
}

afterEach(cleanup);

it('downloads the compiled PDF as the default action', async () => {
  const { compile } = setup([succeeded]);
  const baixar = screen.getByRole('button', { name: 'Baixar' }) as HTMLButtonElement;
  await waitFor(() => expect(baixar.disabled).toBe(false));
  await userEvent.click(baixar);
  expect(compile.downloadPdf).toHaveBeenCalledWith('p1', 'b1');
});

it('disables the PDF action when no build has succeeded', () => {
  setup([]);
  expect((screen.getByRole('button', { name: 'Baixar' }) as HTMLButtonElement).disabled).toBe(true);
});

it('downloads the project source from the caret menu', async () => {
  const { projects, container } = setup([]);
  const caret = container.querySelector('summary') as HTMLElement;
  await userEvent.click(caret);
  await userEvent.click(screen.getByRole('button', { name: /Fonte \(\.zip\)/ }));
  expect(projects.downloadSource).toHaveBeenCalledWith('p1');
});

it('surfaces an error when an export fails instead of failing silently', async () => {
  const tools = {
    requestExport: vi.fn().mockRejectedValue(new Error('spawn pandoc ENOENT')),
  } as unknown as ToolsService;
  const { container } = setup([succeeded], true, tools);
  await userEvent.click(container.querySelector('summary') as HTMLElement);
  await userEvent.click(screen.getByRole('button', { name: /Word \(\.docx\)/ }));
  expect((await screen.findByRole('alert')).textContent).toMatch(/Falha ao exportar/);
});
