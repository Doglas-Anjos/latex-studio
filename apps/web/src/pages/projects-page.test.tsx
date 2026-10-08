// @vitest-environment jsdom
import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Container } from '../di/container';
import {
  type Project,
  type ProjectListOptions,
  type ProjectService,
  ProjectServiceToken,
} from '../services/project.service';
import { renderWithApp } from '../test/render';
import { ProjectsPage } from './projects-page';

const base = { ownerId: 'u', mainFile: 'main.tex', engine: 'pdflatex' as const, createdAt: '' };
const list: Project[] = [
  { ...base, id: '1', name: 'Tese', role: 'owner', updatedAt: '2026-01-01T10:00:00Z' },
  { ...base, id: '2', name: 'Artigo', role: 'owner', updatedAt: '2026-02-01T10:00:00Z' },
  { ...base, id: '3', name: 'Relatório', role: 'editor', updatedAt: '2026-03-01T10:00:00Z' },
];

function setup(projects = list) {
  const sorted = [...projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const service = {
    list: vi.fn().mockImplementation(async (options: ProjectListOptions = {}) => {
      const filtered = sorted
        .filter((p) =>
          !options.filter || options.filter === 'all'
            ? true
            : (p.role === 'owner') === (options.filter === 'mine'),
        )
        .filter((p) =>
          p.name
            .normalize('NFD')
            .replace(/\p{Diacritic}/gu, '')
            .toLowerCase()
            .includes((options.search ?? '').toLowerCase()),
        );
      const anchor = filtered.find((p) => p.id === options.cursor);
      const remaining = anchor
        ? filtered.filter(
            (p) =>
              p.updatedAt < anchor.updatedAt ||
              (p.updatedAt === anchor.updatedAt && p.id < anchor.id),
          )
        : filtered;
      const items = remaining.slice(0, options.limit ?? 10);
      return {
        items,
        total: filtered.length,
        nextCursor: remaining.length > items.length ? (items.at(-1)?.id ?? null) : null,
      };
    }),
    remove: vi.fn().mockResolvedValue(undefined),
  } as unknown as ProjectService;
  renderWithApp(<ProjectsPage />, new Container().register(ProjectServiceToken, service));
  return service;
}
const bodyRows = () => screen.getAllByRole('row').slice(1);

describe('ProjectsPage', () => {
  beforeEach(() => {
    HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    });
  });
  afterEach(cleanup);

  it('lists projects, newest first, and filters by search', async () => {
    setup();
    await screen.findByText('Tese');
    expect(bodyRows()).toHaveLength(3);
    expect(within(bodyRows()[0] as HTMLElement).getByText('Relatório')).toBeTruthy();
    await userEvent.type(screen.getByPlaceholderText('Buscar projeto'), 'relatorio');
    expect(bodyRows()).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Continuar projeto Relatório' })).toBeNull();
  });

  it('shows the most recently changed project as a quick way back', async () => {
    const service = setup();
    expect(await screen.findByRole('button', { name: 'Continuar projeto Relatório' })).toBeTruthy();
    expect(service.list).toHaveBeenCalledWith(expect.objectContaining({ limit: 10 }));
    expect(screen.queryByText('Sua biblioteca')).toBeNull();
  });

  it('hides shared projects under "Meus projetos"', async () => {
    setup();
    await screen.findByText('Tese');
    await userEvent.click(screen.getByRole('button', { name: 'Meus projetos' }));
    expect(bodyRows()).toHaveLength(2);
    expect(bodyRows().some((row) => within(row).queryByText('Relatório'))).toBe(false);
  });

  it('opens the create dialog from the menu', async () => {
    setup();
    await screen.findByText('Tese');
    await userEvent.click(screen.getByText('Novo projeto', { selector: 'summary' }));
    await userEvent.click(screen.getByRole('button', { name: 'Projeto em branco' }));
    expect(screen.getByRole('dialog', { name: 'Novo projeto' })).toBeTruthy();
  });

  it('asks for confirmation before deleting a project and calls the API on confirm', async () => {
    const service = setup();
    await screen.findByText('Tese');
    const row = within(bodyRows()[2] as HTMLElement); // Tese, owner
    await userEvent.click(row.getByRole('button', { name: 'Excluir' }));
    const dialog = screen.getByRole('dialog', { name: 'Excluir projeto' });
    expect(within(dialog).getByText(/não pode ser desfeita/)).toBeTruthy();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Excluir' }));
    expect(service.remove).toHaveBeenCalledWith('1');
  });

  it('opens the help dialog from the button', async () => {
    setup();
    await screen.findByText('Tese');
    await userEvent.click(screen.getByRole('button', { name: /Como funciona/ }));
    expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalled();
    expect(screen.getByText('Como o LaTeX Studio funciona', { selector: 'h2' })).toBeTruthy();
  });

  it('shows a clear first-project action without covering the empty page', async () => {
    setup([]);
    await screen.findByText('Ainda não há projetos');
    expect(HTMLDialogElement.prototype.showModal).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Criar projeto' }));
    expect(screen.getByRole('dialog', { name: 'Novo projeto' })).toBeTruthy();
  });

  it('uses the returned cursor for the next page and keeps a path back', async () => {
    const many = Array.from({ length: 12 }, (_, index) => ({
      ...base,
      id: String(index),
      name: `Projeto ${String(index).padStart(2, '0')}`,
      role: 'owner' as const,
      updatedAt: new Date(2026, 0, index + 1).toISOString(),
    }));
    const service = setup(many);
    await within(await screen.findByRole('table')).findByText('Projeto 11');
    expect(bodyRows()).toHaveLength(10);
    await userEvent.click(screen.getByRole('button', { name: /Próxima/ }));
    await screen.findByText('Projeto 01');
    expect(bodyRows()).toHaveLength(2);
    expect(service.list).toHaveBeenCalledWith(expect.objectContaining({ cursor: '2' }));
    await userEvent.click(screen.getByRole('button', { name: 'Anterior' }));
    await within(screen.getByRole('table')).findByText('Projeto 11');
    expect(bodyRows()).toHaveLength(10);
  });
});
