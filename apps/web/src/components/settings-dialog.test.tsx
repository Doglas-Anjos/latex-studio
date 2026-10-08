// @vitest-environment jsdom

import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Container } from '../di/container';
import type { Project } from '../services/project.service';
import { type ProjectService, ProjectServiceToken } from '../services/project.service';
import { useSettingsStore } from '../settings-store';
import { SYNTAX_THEMES } from '../syntax-themes';
import { renderWithApp } from '../test/render';
import { SettingsDialog } from './settings-dialog';

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
  const projects = {
    get: vi.fn().mockResolvedValue(fakeProject),
    update: vi.fn().mockResolvedValue(fakeProject),
  } as unknown as ProjectService;
  const { container } = renderWithApp(
    <SettingsDialog ref={createRef<HTMLDialogElement>()} projectId="p1" />,
    new Container().register(ProjectServiceToken, projects),
  );
  return { projects, container };
}

beforeEach(() => useSettingsStore.getState().reset());
afterEach(cleanup);

it('switches to Compilação and toggles a compile setting on the store', async () => {
  const before = useSettingsStore.getState().autoCompile;
  setup();
  await userEvent.click(screen.getByRole('button', { name: 'Compilação', hidden: true }));
  await userEvent.click(screen.getByLabelText('Compilação automática'));
  expect(useSettingsStore.getState().autoCompile).toBe(!before);
});

it('changes the LaTeX engine on the project', async () => {
  const { projects } = setup();
  await userEvent.click(screen.getByRole('button', { name: 'Compilação', hidden: true }));
  const select = await screen.findByLabelText('Motor LaTeX');
  await waitFor(() => expect((select as HTMLSelectElement).disabled).toBe(false));
  await userEvent.selectOptions(select, 'xelatex');
  expect(projects.update).toHaveBeenCalledWith('p1', { engine: 'xelatex' });
});

it('applies a preset palette to the store', async () => {
  setup();
  await userEvent.click(screen.getByRole('button', { name: 'Aparência', hidden: true }));
  await userEvent.selectOptions(screen.getByLabelText('Paleta de cores'), 'monokai');
  expect(useSettingsStore.getState().syntax).toEqual(SYNTAX_THEMES.monokai?.syntax);
  expect(useSettingsStore.getState().theme).toBe('dark');
});

it('imports JSON through a real button under Aparência', async () => {
  const { container } = setup();
  await userEvent.click(screen.getByRole('button', { name: 'Aparência', hidden: true }));
  const button = screen.getByText('Importar JSON');
  expect(button.tagName).toBe('BUTTON');
  const input = container.querySelector('input[type="file"]');
  expect(input).toBeTruthy();
  const click = vi.fn();
  input?.addEventListener('click', click);
  await userEvent.click(button);
  expect(click).toHaveBeenCalledTimes(1);
});

it('previews every editor font and applies the one picked', async () => {
  setup();
  await userEvent.click(screen.getByRole('button', { name: 'Aparência', hidden: true }));
  const fira = screen.getByRole('radio', { name: /Fira Code/, hidden: true });
  const sample = fira.closest('label')?.querySelector<HTMLElement>('.font-sample');
  expect(sample?.style.fontFamily).toContain('Fira Code');
  expect(sample?.textContent).toContain(String.raw`\section{Introdução}`);
  await userEvent.click(fira);
  expect(useSettingsStore.getState().editorFont).toContain('Fira Code');
});
