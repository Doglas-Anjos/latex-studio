// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Container } from '../di/container';
import { type FileService, FileServiceToken } from '../services/file.service';
import { renderWithApp } from '../test/render';
import { closeWhenSynced, Editor, markUnsynced, peersFrom } from './editor';

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

describe('closeWhenSynced', () => {
  afterEach(() => vi.useRealTimers());

  function fakeProvider(unsynced: boolean) {
    const handlers: { event: string; h: (e: { number: number }) => void }[] = [];
    return {
      hasUnsyncedChanges: unsynced,
      on: vi.fn((event: string, h: (e: { number: number }) => void) => handlers.push({ event, h })),
      destroy: vi.fn(),
      emit: (number: number) => {
        for (const x of handlers) if (x.event === 'unsyncedChanges') x.h({ number });
      },
      refuse: () => {
        for (const x of handlers) if (x.event === 'authenticationFailed') x.h({ number: 0 });
      },
    };
  }

  it('waits for the last edit to sync, prompting on unload meanwhile', () => {
    const unload = () => !window.dispatchEvent(new Event('beforeunload', { cancelable: true }));
    const provider = fakeProvider(true);
    const doc = { destroy: vi.fn() };
    markUnsynced(provider, true); // what the editor's unsyncedChanges listener does
    closeWhenSynced(provider as never, doc);
    expect(provider.destroy).not.toHaveBeenCalled();
    expect(unload()).toBe(true);
    provider.emit(0);
    expect(provider.destroy).toHaveBeenCalledTimes(1);
    expect(doc.destroy).toHaveBeenCalledTimes(1);
    expect(unload()).toBe(false);
  });

  it('keeps offline edits however long it takes, ends on refusal or when nothing is pending', () => {
    vi.useFakeTimers();
    const offline = fakeProvider(true);
    markUnsynced(offline, true);
    closeWhenSynced(offline as never, { destroy: vi.fn() });
    vi.advanceTimersByTime(60 * 60_000);
    expect(offline.destroy).not.toHaveBeenCalled();
    expect(window.dispatchEvent(new Event('beforeunload', { cancelable: true }))).toBe(false);
    offline.refuse();
    expect(offline.destroy).toHaveBeenCalledTimes(1);
    offline.emit(0);
    expect(offline.destroy).toHaveBeenCalledTimes(1);

    const clean = fakeProvider(false);
    closeWhenSynced(clean as never, { destroy: vi.fn() });
    expect(clean.destroy).toHaveBeenCalledTimes(1);
  });
});

describe('peersFrom', () => {
  it('keys peers by client, skips self, and drops a non-hex colour', () => {
    const states = new Map<number, Record<string, unknown>>([
      [1, { user: { name: 'Me', color: '#000000' } }],
      [2, { user: { name: 'Ana', color: '#1f6fa8' } }],
      [3, { user: { name: 'Ana', color: 'red;background:url(x)' } }],
      [4, {}],
    ]);
    expect(peersFrom(states, 1)).toEqual([
      { id: 2, name: 'Ana', color: '#1f6fa8' },
      { id: 3, name: 'Ana', color: 'var(--muted)' },
    ]);
  });

  it('hides the same account connected from another tab', () => {
    const states = new Map<number, Record<string, unknown>>([
      [1, { user: { id: 'u1', name: 'Local', color: '#000000' } }],
      [5, { user: { id: 'u1', name: 'Local', color: '#000000' } }],
      [6, { user: { id: 'u2', name: 'Ana', color: '#1f6fa8' } }],
    ]);
    expect(peersFrom(states, 1, 'u1')).toEqual([{ id: 6, name: 'Ana', color: '#1f6fa8' }]);
  });
});
