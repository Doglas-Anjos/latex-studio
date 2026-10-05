// @vitest-environment jsdom
import { useQuery } from '@tanstack/react-query';
import { act, cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Container } from '../di/container';
import { useService } from '../di/service-provider';
import {
  type Build,
  type CompileService,
  CompileServiceToken,
  STALE_BUILD_MS,
} from '../services/compile.service';
import { type FileService, FileServiceToken } from '../services/file.service';
import { type PackageService, PackageServiceToken } from '../services/package.service';
import type { Project, UpdatedProject } from '../services/project.service';
import { type ProjectService, ProjectServiceToken } from '../services/project.service';
import { type ToolsService, ToolsServiceToken } from '../services/tools.service';
import { useSettingsStore } from '../settings-store';
import { renderWithApp } from '../test/render';
import { useWorkspaceStore } from '../workspace-store';
import { BuildPanel } from './build-panel';

const fakeProject: Project = {
  id: 'p1',
  ownerId: 'owner',
  name: 'Thesis',
  mainFile: 'main.tex',
  engine: 'pdflatex',
  role: 'owner',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

function setup() {
  const compile = { builds: vi.fn().mockResolvedValue([]) } as unknown as CompileService;
  const projects = {
    downloadSource: vi.fn(),
    get: vi.fn().mockResolvedValue(fakeProject),
  } as unknown as ProjectService;
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
    useSettingsStore.getState().reset();
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

describe('BuildPanel compact bar and logs toggle', () => {
  beforeEach(() => {
    useSettingsStore.getState().reset();
  });
  afterEach(cleanup);

  it('keeps compile, engine, status and download visible while logs stay closed, and the toggle reveals them', async () => {
    const build = {
      id: 'b1',
      projectId: 'p1',
      status: 'failed' as const,
      engine: 'pdflatex',
      mainFile: 'main.tex',
      commitSha: null,
      exitCode: 1,
      errors: [{ message: 'Undefined control sequence' }],
      warnings: [],
      createdAt: '',
      startedAt: null,
      finishedAt: null,
    };
    const compile = { builds: vi.fn().mockResolvedValue([build]) } as unknown as CompileService;
    const projects = {
      downloadSource: vi.fn(),
      get: vi.fn().mockResolvedValue(fakeProject),
    } as unknown as ProjectService;
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

    expect(await screen.findByText('Falhou')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Compilar' })).toBeTruthy();
    expect(screen.getByLabelText('Motor LaTeX')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Baixar' })).toBeTruthy();
    expect(screen.queryByText('Undefined control sequence')).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Mostrar logs' }));
    expect(await screen.findByText('Undefined control sequence')).toBeTruthy();
  });
});

describe('BuildPanel problem counts', () => {
  beforeEach(() => {
    useSettingsStore.getState().reset();
  });
  afterEach(cleanup);

  it('shows error and warning counts that open the panel and filter the list', async () => {
    const build = {
      id: 'b1',
      projectId: 'p1',
      status: 'failed' as const,
      engine: 'pdflatex',
      mainFile: 'main.tex',
      commitSha: null,
      exitCode: 1,
      errors: [{ file: './main.tex', line: 3, message: 'Undefined control sequence' }],
      warnings: [
        { file: './cap.tex', line: 9, message: 'Overfull hbox' },
        { file: './cap.tex', line: 2, message: 'Underfull hbox' },
      ],
      createdAt: '',
      startedAt: null,
      finishedAt: null,
    };
    const compile = { builds: vi.fn().mockResolvedValue([build]) } as unknown as CompileService;
    const packages = {
      get: vi.fn().mockResolvedValue([]),
      usage: vi.fn().mockResolvedValue([]),
    } as unknown as PackageService;
    renderWithApp(
      <BuildPanel projectId="p1" canCompile={true} />,
      new Container()
        .register(CompileServiceToken, compile)
        .register(ProjectServiceToken, {
          downloadSource: vi.fn(),
          get: vi.fn().mockResolvedValue(fakeProject),
        } as unknown as ProjectService)
        .register(ToolsServiceToken, {} as unknown as ToolsService)
        .register(FileServiceToken, {} as unknown as FileService)
        .register(PackageServiceToken, packages),
    );
    const warnings = await screen.findByRole('button', { name: '2 avisos' });
    expect(screen.getByRole('button', { name: '1 erro' })).toBeTruthy();
    await userEvent.click(warnings);
    expect(await screen.findByText('Underfull hbox')).toBeTruthy();
    expect(screen.queryByText('Undefined control sequence')).toBeNull();
    expect(useSettingsStore.getState().panelOpen).toBe(true);
    await userEvent.click(warnings);
    expect(await screen.findByText('Undefined control sequence')).toBeTruthy();
  });
});

describe('BuildPanel failure without structured errors', () => {
  beforeEach(() => {
    useSettingsStore.getState().reset();
  });
  afterEach(cleanup);

  type PartialBuild = Partial<Build> & Pick<Build, 'status'>;

  function renderPanel(overrides: PartialBuild) {
    const build: Build = {
      id: 'b1',
      projectId: 'p1',
      engine: 'xelatex',
      mainFile: 'main.tex',
      commitSha: null,
      exitCode: null,
      errors: [],
      warnings: [],
      createdAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      ...overrides,
    };
    const compile = {
      builds: vi.fn().mockResolvedValue([build]),
      openLog: vi.fn().mockResolvedValue(undefined),
    } as unknown as CompileService;
    renderWithApp(
      <BuildPanel projectId="p1" canCompile={true} />,
      new Container()
        .register(CompileServiceToken, compile)
        .register(ProjectServiceToken, {
          downloadSource: vi.fn(),
          get: vi.fn().mockResolvedValue(fakeProject),
        } as unknown as ProjectService)
        .register(ToolsServiceToken, {} as unknown as ToolsService)
        .register(FileServiceToken, {} as unknown as FileService)
        .register(PackageServiceToken, {
          get: vi.fn().mockResolvedValue([]),
          usage: vi.fn().mockResolvedValue([]),
        } as unknown as PackageService),
    );
    return { compile };
  }

  // QA on the real engine matrix produced exactly this build: LuaLaTeX exited 12 on a font the
  // installation lacks, and pdfLaTeX exited 12 on sources that need fontspec, both with an empty
  // `errors` array. Before this, the panel answered "0 erros · sem problemas · Compilado sem
  // erros ou avisos" to a failed compile.
  it('explains a failed build whose log yielded no error instead of reading as a clean compile', async () => {
    const { compile } = renderPanel({ status: 'failed', exitCode: 12 });

    expect(await screen.findByText('Falhou')).toBeTruthy();
    expect(screen.queryByText(/sem problemas/)).toBeNull();
    // The counts stay faithful: nothing was parsed, so nothing is claimed.
    const errorCount = screen.getByRole('button', { name: '0 erros' }) as HTMLButtonElement;
    expect(errorCount.disabled).toBe(true);
    expect((screen.getByRole('button', { name: '0 avisos' }) as HTMLButtonElement).disabled).toBe(
      true,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Mostrar logs' }));

    expect(screen.queryByText(/Compilado sem erros ou avisos/)).toBeNull();
    const note = await screen.findByText(/nenhum erro foi extraído do log/);
    expect(note.textContent).toMatch(/Falhou/);
    expect(note.textContent).toMatch(/código de saída 12/);

    await userEvent.click(screen.getByRole('button', { name: 'ver log completo' }));
    expect(compile.openLog).toHaveBeenCalledWith('p1', 'b1');
  });

  it('keeps the warning list and count while explaining a timeout that parsed no error', async () => {
    renderPanel({
      status: 'timeout',
      exitCode: null,
      warnings: [{ file: './main.tex', line: 4, message: 'Overfull hbox' }],
    });

    expect(await screen.findByText('Tempo esgotado')).toBeTruthy();
    expect(screen.queryByText(/sem problemas/)).toBeNull();
    expect(screen.getByRole('button', { name: '1 aviso' })).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Mostrar logs' }));

    expect(screen.queryByText(/Compilado sem erros ou avisos/)).toBeNull();
    const note = await screen.findByText(/nenhum erro foi extraído do log/);
    expect(note.textContent).toMatch(/Tempo esgotado/);
    // No exit code was recorded: the panel must not invent one.
    expect(note.textContent).not.toMatch(/código de saída/);
    // The warning is still listed and the filter still works on it.
    expect(screen.getByText('Overfull hbox')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: '1 aviso' }));
    expect(screen.getByText('Overfull hbox')).toBeTruthy();
  });

  it('still reports a clean compile when the build succeeded with nothing to show', async () => {
    renderPanel({ status: 'succeeded', exitCode: 0 });

    expect(await screen.findByText('Compilado com sucesso')).toBeTruthy();
    expect(screen.getByText(/sem problemas/)).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Mostrar logs' }));

    expect(await screen.findByText('Compilado sem erros ou avisos.')).toBeTruthy();
    expect(screen.queryByText(/nenhum erro foi extraído do log/)).toBeNull();
  });
});

describe('BuildPanel active and stuck builds', () => {
  beforeEach(() => {
    useSettingsStore.getState().reset();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  function activeBuild(startedAt: string | null) {
    return {
      id: 'b1',
      projectId: 'p1',
      status: 'running' as const,
      engine: 'pdflatex',
      mainFile: 'main.tex',
      commitSha: null,
      exitCode: null,
      errors: [],
      warnings: [],
      createdAt: startedAt ?? new Date().toISOString(),
      startedAt,
      finishedAt: null,
    };
  }

  function setupWith(build: ReturnType<typeof activeBuild>) {
    const compile = {
      builds: vi.fn().mockResolvedValue([build]),
      compile: vi.fn().mockResolvedValue({ ...build, id: 'b2', status: 'queued' }),
    } as unknown as CompileService;
    const packages = {
      get: vi.fn().mockResolvedValue([]),
      usage: vi.fn().mockResolvedValue([]),
    } as unknown as PackageService;
    renderWithApp(
      <BuildPanel projectId="p1" canCompile={true} />,
      new Container()
        .register(CompileServiceToken, compile)
        .register(ProjectServiceToken, {
          downloadSource: vi.fn(),
          get: vi.fn().mockResolvedValue(fakeProject),
        } as unknown as ProjectService)
        .register(ToolsServiceToken, {} as unknown as ToolsService)
        .register(FileServiceToken, {} as unknown as FileService)
        .register(PackageServiceToken, packages),
    );
    return { compile };
  }

  it('offers Parar instead of Compilar while a fresh build is running', async () => {
    setupWith(activeBuild(new Date().toISOString()));
    await screen.findByText(/Compilando…/);
    expect(screen.getByRole('button', { name: /Parar/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Compilar' })).toBeNull();
  });
  it('ticks the elapsed counter every second and reaches the retry state without a new build', async () => {
    vi.useFakeTimers();
    setupWith(activeBuild(new Date().toISOString()));
    // The polled build never changes here: only the clock moves.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText('Compilando… (0s)')).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(screen.getByText('Compilando… (3s)')).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(STALE_BUILD_MS);
    });
    expect(screen.getByText(/Sem resposta há \d+s/)).toBeTruthy();
    const retry = screen.getByRole('button', { name: 'Tentar novamente' }) as HTMLButtonElement;
    expect(retry.disabled).toBe(false);
  });

  it('turns the button into a retry once the active build looks orphaned', async () => {
    const staleStart = new Date(Date.now() - 10 * 60_000).toISOString();
    const { compile } = setupWith(activeBuild(staleStart));
    const button = (await screen.findByRole('button', {
      name: 'Tentar novamente',
    })) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    expect(button.title).toMatch(/Sem resposta/);

    await userEvent.click(button);
    expect(compile.compile).toHaveBeenCalledWith('p1', expect.any(Object));
  });
});

describe('BuildPanel engine change in flight', () => {
  beforeEach(() => {
    useSettingsStore.getState().reset();
  });
  afterEach(cleanup);

  it('disables Compilar while the chosen engine is still being saved, so it cannot fire with the stale one', async () => {
    const project = fakeProject;
    let resolveUpdate: (p: Project) => void = () => {};
    const projects = {
      downloadSource: vi.fn(),
      get: vi.fn().mockResolvedValue(project),
      update: vi.fn(
        () =>
          new Promise<Project>((resolve) => {
            resolveUpdate = resolve;
          }),
      ),
    } as unknown as ProjectService;
    const compile = {
      builds: vi.fn().mockResolvedValue([]),
      compile: vi.fn().mockResolvedValue({}),
    } as unknown as CompileService;
    const packages = {
      get: vi.fn().mockResolvedValue([]),
      usage: vi.fn().mockResolvedValue([]),
    } as unknown as PackageService;
    renderWithApp(
      <BuildPanel projectId="p1" canCompile={true} />,
      new Container()
        .register(CompileServiceToken, compile)
        .register(ProjectServiceToken, projects)
        .register(ToolsServiceToken, {} as unknown as ToolsService)
        .register(FileServiceToken, {} as unknown as FileService)
        .register(PackageServiceToken, packages),
    );

    const select = (await screen.findByLabelText('Motor LaTeX')) as HTMLSelectElement;
    const button = screen.getByRole('button', { name: 'Compilar' }) as HTMLButtonElement;
    await waitFor(() => expect(button.disabled).toBe(false));

    await userEvent.selectOptions(select, 'xelatex');
    expect(button.disabled).toBe(true);
    expect(button.title).toMatch(/motor/i);

    resolveUpdate({ ...project, engine: 'xelatex' });
    await waitFor(() => expect(button.disabled).toBe(false));
    expect(compile.compile).not.toHaveBeenCalled();
  });
});

describe('BuildPanel engine change and permissions', () => {
  beforeEach(() => {
    useSettingsStore.getState().reset();
  });
  afterEach(cleanup);

  /** Mirrors ProjectPage: canCompile comes from the role on the cached project. */
  function PanelWithRoleFromCache() {
    const projects = useService(ProjectServiceToken);
    const { data: project } = useQuery({
      queryKey: ['project', 'p1'],
      queryFn: () => projects.get('p1'),
    });
    const canEdit = project?.role === 'owner' || project?.role === 'editor';
    return <BuildPanel projectId="p1" canCompile={canEdit} />;
  }

  it('keeps the role in the cache when the engine is saved, so Compilar stays usable', async () => {
    // The real PATCH echoes the project; the role is the caller's own, so treat it as absent here.
    const { role: _role, ...savedWithoutRole } = { ...fakeProject, engine: 'lualatex' as const };
    const projects = {
      downloadSource: vi.fn(),
      get: vi.fn().mockResolvedValue(fakeProject),
      update: vi.fn<(id: string, patch: unknown) => Promise<UpdatedProject>>(() =>
        Promise.resolve(savedWithoutRole),
      ),
    } as unknown as ProjectService;
    const compile = {
      builds: vi.fn().mockResolvedValue([]),
      compile: vi.fn().mockResolvedValue({ id: 'b1', errors: [], warnings: [] }),
    } as unknown as CompileService;
    const packages = {
      get: vi.fn().mockResolvedValue([]),
      usage: vi.fn().mockResolvedValue([]),
    } as unknown as PackageService;
    renderWithApp(
      <PanelWithRoleFromCache />,
      new Container()
        .register(CompileServiceToken, compile)
        .register(ProjectServiceToken, projects)
        .register(ToolsServiceToken, {} as unknown as ToolsService)
        .register(FileServiceToken, {} as unknown as FileService)
        .register(PackageServiceToken, packages),
    );

    const select = (await screen.findByLabelText('Motor LaTeX')) as HTMLSelectElement;
    const button = screen.getByRole('button', { name: 'Compilar' }) as HTMLButtonElement;
    await waitFor(() => expect(button.disabled).toBe(false));

    await userEvent.selectOptions(select, 'lualatex');

    await waitFor(() => expect(button.disabled).toBe(false));
    expect(projects.update).toHaveBeenCalledWith('p1', { engine: 'lualatex' });
    expect(select.value).toBe('lualatex');
    expect(button.title ?? '').not.toMatch(/permiss/i);
    expect(select.disabled).toBe(false);

    await userEvent.click(button);
    expect(compile.compile).toHaveBeenCalledWith('p1', expect.any(Object));
  });
});

describe('BuildPanel compile options menu and auto compile', () => {
  beforeEach(() => {
    useSettingsStore.getState().reset();
    useWorkspaceStore.getState().reset();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  function mount() {
    const compile = {
      builds: vi.fn().mockResolvedValue([]),
      compile: vi.fn().mockReturnValue(new Promise(() => {})),
    } as unknown as CompileService;
    renderWithApp(
      <BuildPanel projectId="p1" canCompile={true} />,
      new Container()
        .register(CompileServiceToken, compile)
        .register(ProjectServiceToken, {
          get: vi.fn().mockResolvedValue(fakeProject),
        } as unknown as ProjectService)
        .register(ToolsServiceToken, {} as unknown as ToolsService)
        .register(FileServiceToken, {} as unknown as FileService)
        .register(PackageServiceToken, {
          get: vi.fn().mockResolvedValue([]),
          usage: vi.fn().mockResolvedValue([]),
        } as unknown as PackageService),
    );
    return { compile };
  }

  it('moves focus into the portalled menu and back to the caret on Escape', async () => {
    mount();
    const caret = screen.getByRole('button', { name: 'Opções de compilação' });
    await waitFor(() => expect((caret as HTMLButtonElement).disabled).toBe(false));
    await userEvent.click(caret);
    expect(document.activeElement?.textContent).toContain('Ligada');
    await userEvent.keyboard('{Escape}');
    expect(document.activeElement).toBe(caret);
  });

  it('opens the menu upwards from a caret at the bottom with only a bottom offset', async () => {
    mount();
    const caret = screen.getByRole('button', { name: 'Opções de compilação' });
    await waitFor(() => expect((caret as HTMLButtonElement).disabled).toBe(false));
    // The build bar sits at the bottom of the window: no room below the caret.
    caret.getBoundingClientRect = () =>
      ({ left: 400, top: window.innerHeight - 40, bottom: window.innerHeight - 8 }) as DOMRect;
    await userEvent.click(caret);
    const menu = document.querySelector('.compile-menu-body') as HTMLElement;
    // Both top and bottom set at once squeezed the real menu to a sliver below the window.
    expect(menu.style.top).toBe('auto');
    expect(menu.style.bottom).not.toBe('auto');
  });

  it('compiles 3 s after a local edit, once, and not on mount', async () => {
    useSettingsStore.getState().set({ autoCompile: true });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { compile } = mount();
    await screen.findByRole('button', { name: 'Compilar' });
    act(() => vi.advanceTimersByTime(5000));
    expect(compile.compile).not.toHaveBeenCalled();
    act(() => useWorkspaceStore.getState().bumpDocVersion());
    act(() => vi.advanceTimersByTime(3000));
    await waitFor(() => expect(compile.compile).toHaveBeenCalledTimes(1));
    // Still pending: another edit must not stack a second request.
    act(() => useWorkspaceStore.getState().bumpDocVersion());
    act(() => vi.advanceTimersByTime(3000));
    expect(compile.compile).toHaveBeenCalledTimes(1);
  });
});
