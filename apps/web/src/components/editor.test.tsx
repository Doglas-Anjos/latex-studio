// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Container } from '../di/container';
import { AuthServiceToken } from '../services/auth.service';
import { CommentServiceToken } from '../services/comment.service';
import { type FileService, FileServiceToken } from '../services/file.service';
import { HistoryServiceToken } from '../services/history.service';
import { IdentityToken } from '../services/identity';
import { ReferenceServiceToken } from '../services/reference.service';
import { SpellcheckServiceToken } from '../services/spellcheck.service';
import { renderWithApp } from '../test/render';
import { closeWhenSynced, Editor, markUnsynced, peersFrom } from './editor';

/** Stands in for the websocket provider: tests emit its events by hand. */
const { providers, FakeProvider } = vi.hoisted(() => {
  type Handler = (...args: unknown[]) => void;
  class FakeProvider {
    awareness = null;
    hasUnsyncedChanges = false;
    handlers: { event: string; h: Handler }[] = [];
    disconnect = vi.fn();
    destroy = vi.fn();
    constructor() {
      providers.push(this);
    }
    on(event: string, h: Handler) {
      this.handlers.push({ event, h });
    }
    off(event: string, h: Handler) {
      this.handlers = this.handlers.filter((x) => x.event !== event || x.h !== h);
    }
    emit(event: string, payload: unknown) {
      for (const x of this.handlers) if (x.event === event) x.h(payload);
    }
  }
  const providers: FakeProvider[] = [];
  return { providers, FakeProvider };
});
vi.mock('@hocuspocus/provider', () => ({ HocuspocusProvider: FakeProvider }));

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

describe('collab editor refused by the server', () => {
  afterEach(cleanup);

  it('keeps the session while the file is listed (a token problem), freezes once it is gone', async () => {
    const list = vi.fn().mockResolvedValue([{ path: 'notes.txt', size: 10 }]);
    const container = new Container()
      .register(FileServiceToken, { ...fake(), list })
      .register(CommentServiceToken, { list: vi.fn().mockResolvedValue([]) } as never)
      .register(IdentityToken, { enabled: false, token: async () => null } as never)
      .register(HistoryServiceToken, {
        status: vi.fn().mockResolvedValue({ baseline: null, changes: [] }),
      } as never)
      .register(ReferenceServiceToken, {} as never)
      .register(SpellcheckServiceToken, {} as never)
      .register(AuthServiceToken, { me: vi.fn().mockResolvedValue({ id: 'u1' }) } as never);
    renderWithApp(<Editor projectId="p1" path="notes.txt" role={ROLE} />, container);
    const provider = providers.at(-1) as InstanceType<typeof FakeProvider>;

    act(() => provider.emit('authenticationFailed', { reason: 'permission-denied' }));
    await waitFor(() => expect(list).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(provider.disconnect).not.toHaveBeenCalled();

    list.mockResolvedValue([]);
    act(() => provider.emit('authenticationFailed', { reason: 'permission-denied' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Arquivo removido ou renomeado');
    expect(provider.disconnect).toHaveBeenCalled();
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
