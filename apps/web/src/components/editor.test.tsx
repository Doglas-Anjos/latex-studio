// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Container } from '../di/container';
import { type FileService, FileServiceToken } from '../services/file.service';
import { renderWithApp } from '../test/render';
import { Editor } from './editor';

const ROLE = 'editor' as const;

const fake = (): FileService => ({
  list: vi.fn(),
  download: vi.fn(),
  blob: vi.fn().mockResolvedValue(new Blob(['x'], { type: 'image/png' })),
  create: vi.fn(),
  createFolder: vi.fn(),
  remove: vi.fn(),
  rename: vi.fn(),
  upload: vi.fn(),
  write: vi.fn(),
});

describe('image preview zoom', () => {
  const realCreateObjectURL = URL.createObjectURL;
  const realRevokeObjectURL = URL.revokeObjectURL;
  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => 'blob:fake');
    URL.revokeObjectURL = vi.fn();
  });
  afterEach(() => {
    cleanup();
    URL.createObjectURL = realCreateObjectURL;
    URL.revokeObjectURL = realRevokeObjectURL;
  });

  it('zooms the image with ctrl+wheel, not with plain wheel, and resets', async () => {
    renderWithApp(
      <Editor projectId="p1" path="figure.png" role={ROLE} />,
      new Container().register(FileServiceToken, fake()),
    );

    const img = await screen.findByAltText('figure.png');
    const group = screen.getByRole('group', { name: 'Zoom' });
    expect(within(group).getByText('100%')).toBeTruthy();

    const body = document.querySelector('.image-preview-body') as HTMLElement;
    const notPrevented = fireEvent.wheel(body, { deltaY: -200, ctrlKey: true });
    expect(notPrevented).toBe(false);
    expect(within(group).queryByText('100%')).toBeNull();
    expect(img.style.transform).toMatch(/scale\(/);

    const zoomedLabel = group.textContent;
    fireEvent.wheel(body, { deltaY: -200, ctrlKey: false });
    expect(group.textContent).toBe(zoomedLabel);

    await userEvent.click(screen.getByRole('button', { name: /clique para restaurar/ }));
    expect(within(group).getByText('100%')).toBeTruthy();
  });
});
