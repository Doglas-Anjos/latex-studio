// @vitest-environment jsdom
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Container } from '../di/container';
import { type PackageService, PackageServiceToken } from '../services/package.service';
import { renderWithApp } from '../test/render';
import { PackagesPanel } from './packages-panel';

const manifest = [
  { name: 'amsmath', enabled: true, order: 0 },
  { name: 'graphicx', options: 'draft', enabled: true, order: 1 },
];

describe('PackagesPanel', () => {
  afterEach(cleanup);

  it('lists the packages and saves a toggle', async () => {
    const service: PackageService = {
      get: vi.fn().mockResolvedValue(manifest),
      set: vi.fn().mockResolvedValue(manifest),
      migrate: vi.fn(),
      usage: vi.fn().mockResolvedValue([]),
    };
    renderWithApp(
      <PackagesPanel projectId="p1" canEdit />,
      new Container().register(PackageServiceToken, service),
    );
    const boxes = await screen.findAllByRole('switch');
    expect(boxes).toHaveLength(2);
    expect(screen.getByText('graphicx')).toBeTruthy();
    expect((boxes[0] as HTMLElement).getAttribute('aria-checked')).toBe('true');
    await userEvent.click(boxes[0] as HTMLElement);
    await waitFor(() =>
      expect(service.set).toHaveBeenCalledWith('p1', [
        { name: 'amsmath', enabled: false, order: 0 },
        { name: 'graphicx', options: 'draft', enabled: true, order: 1 },
      ]),
    );
  });

  it('lists packages found in the code and turns one off without touching the source', async () => {
    const service: PackageService = {
      get: vi.fn().mockResolvedValue(manifest),
      set: vi.fn().mockResolvedValue(manifest),
      migrate: vi.fn(),
      usage: vi
        .fn()
        .mockResolvedValue([
          { name: 'hyperref', options: 'colorlinks', path: 'main.tex', line: 4 },
        ]),
    };
    renderWithApp(
      <PackagesPanel projectId="p1" canEdit />,
      new Container().register(PackageServiceToken, service),
    );
    expect(await screen.findByText('Detectados no código')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Desligar' }));
    await waitFor(() =>
      expect(service.set).toHaveBeenCalledWith('p1', [
        ...manifest,
        { name: 'hyperref', options: 'colorlinks', enabled: false, order: 2 },
      ]),
    );
  });

  it('re-enables a disabled package and filters by state', async () => {
    const off = [
      { name: 'geometry', options: 'left=3cm', enabled: false, order: 0 },
      { name: 'amsmath', enabled: true, order: 1 },
    ];
    const service: PackageService = {
      get: vi.fn().mockResolvedValue(off),
      set: vi.fn().mockImplementation(async (_p, next) => next),
      migrate: vi.fn(),
      usage: vi.fn().mockResolvedValue([]),
    };
    renderWithApp(
      <PackagesPanel projectId="p1" canEdit />,
      new Container().register(PackageServiceToken, service),
    );
    await userEvent.click(await screen.findByRole('button', { name: /Desligados/ }));
    expect(screen.queryByText('amsmath')).toBeNull();
    await userEvent.click(screen.getByRole('switch', { name: 'Ligar geometry' }));
    await waitFor(() =>
      expect(service.set).toHaveBeenCalledWith('p1', [
        { name: 'geometry', options: 'left=3cm', enabled: true, order: 0 },
        { name: 'amsmath', enabled: true, order: 1 },
      ]),
    );
    await userEvent.click(screen.getByRole('button', { name: /Ativos/ }));
    expect(screen.getByText('amsmath')).toBeTruthy();
  });
});
