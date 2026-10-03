// @vitest-environment jsdom
import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Container } from '../di/container';
import {
  type Project,
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

function setup() {
  const service = { list: vi.fn().mockResolvedValue(list) } as unknown as ProjectService;
  renderWithApp(<ProjectsPage />, new Container().register(ProjectServiceToken, service));
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
  });

  it('hides shared projects under "Meus projetos"', async () => {
    setup();
    await screen.findByText('Tese');
    await userEvent.click(screen.getByRole('button', { name: 'Meus projetos' }));
    expect(bodyRows()).toHaveLength(2);
    expect(screen.queryByText('Relatório')).toBeNull();
  });

  it('opens the create dialog from the menu', async () => {
    setup();
    await screen.findByText('Tese');
    await userEvent.click(screen.getByText('Novo projeto', { selector: 'summary' }));
    await userEvent.click(screen.getByRole('button', { name: 'Projeto em branco' }));
    expect(screen.getByRole('dialog', { name: 'Novo projeto' })).toBeTruthy();
  });
});
