// @vitest-environment jsdom
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Container } from '../di/container';
import { type CompileService, CompileServiceToken } from '../services/compile.service';
import { type FileService, FileServiceToken } from '../services/file.service';
import { type PackageService, PackageServiceToken } from '../services/package.service';
import { type ProjectService, ProjectServiceToken } from '../services/project.service';
import { type ToolsService, ToolsServiceToken } from '../services/tools.service';
import { renderWithApp } from '../test/render';
import { BuildPanel } from './build-panel';

function setup() {
  const compile = { builds: vi.fn().mockResolvedValue([]) } as unknown as CompileService;
  const projects = { downloadSource: vi.fn() } as unknown as ProjectService;
  const tools = {} as unknown as ToolsService;
  const files = {} as unknown as FileService;
  const packages = {
    get: vi.fn().mockResolvedValue([]),
    usage: vi.fn().mockResolvedValue([]),
  } as unknown as PackageService;
  renderWithApp(
    <BuildPanel projectId="p1" canCompile={true} />,
    new Container()
      .register(CompileServiceToken, compile)
      .register(ProjectServiceToken, projects)
      .register(ToolsServiceToken, tools)
      .register(FileServiceToken, files)
      .register(PackageServiceToken, packages),
  );
  return { projects };
}

describe('BuildPanel download dialog', () => {
  beforeEach(() => {
    HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    });
    HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    });
  });
  afterEach(cleanup);

  it('opens from the Baixar button and closes after downloading the source', async () => {
    const { projects } = setup();
    const dialog = document.querySelector('dialog') as HTMLDialogElement;
    expect(dialog.hasAttribute('open')).toBe(false);

    await userEvent.click(screen.getByRole('button', { name: 'Baixar' }));
    expect(dialog.hasAttribute('open')).toBe(true);

    await userEvent.click(screen.getByRole('button', { name: 'Fonte (.zip)' }));
    expect(projects.downloadSource).toHaveBeenCalledWith('p1');
    expect(dialog.hasAttribute('open')).toBe(false);
  });
});
