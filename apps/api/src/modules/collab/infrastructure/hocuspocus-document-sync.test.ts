import { Document, Hocuspocus } from '@hocuspocus/server';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import type { ProjectRepository } from '../../projects/domain/project.repository';
import type { ProjectFiles, ProjectStorage } from '../../projects/domain/project-storage';
import type { YjsDocRepository } from '../domain/yjs-doc.repository';
import { HocuspocusDocumentSync } from './hocuspocus-document-sync';

const setup = () => {
  const hocuspocus = new Hocuspocus({});
  const deleted: string[] = [];
  const saved = new Map<string, Uint8Array>();
  const docs = {
    deleteForPath: async (p: string, path: string) => void deleted.push(`${p}/${path}`),
    save: async (p: string, path: string, state: Uint8Array) =>
      void saved.set(`${p}/${path}`, state),
  } as YjsDocRepository;
  const written = new Map<string, string>();
  const storage = {
    open: (projectId: string) =>
      ({
        write: async (path: string, content: string | Uint8Array) =>
          void written.set(`${projectId}/${path}`, content.toString()),
      }) as ProjectFiles,
  } as ProjectStorage;
  const dirty: string[] = [];
  const projects = {
    markDirty: async (projectId: string) => void dirty.push(projectId),
  } as ProjectRepository;
  return {
    hocuspocus,
    deleted,
    saved,
    written,
    dirty,
    sync: new HocuspocusDocumentSync(hocuspocus, docs, storage, projects),
  };
};

describe('HocuspocusDocumentSync', () => {
  it('patches only the changed span of an open doc, keeping later anchors', async () => {
    const { hocuspocus, deleted, sync } = setup();
    const doc = new Document('p/main.tex');
    const ytext = doc.getText('content');
    ytext.insert(0, 'alpha beta gamma');
    hocuspocus.documents.set('p/main.tex', doc);
    // Anchor on the "g" of "gamma".
    const anchor = Y.createRelativePositionFromTypeIndex(ytext, 11);
    const seen: string[] = [];
    ytext.observe((e) => seen.push(JSON.stringify(e.delta)));

    await sync.replaceText('p', 'main.tex', 'alpha BETA-2 gamma');

    expect(ytext.toString()).toBe('alpha BETA-2 gamma');
    expect(seen).toEqual(['[{"retain":6},{"delete":4},{"insert":"BETA-2"}]']);
    expect(Y.createAbsolutePositionFromRelativePosition(anchor, doc)?.index).toBe(13);
    expect(deleted).toEqual([]);
  });

  it('drops the saved state of a doc that is not open', async () => {
    const { deleted, sync } = setup();
    await sync.replaceText('p', 'main.tex', 'x');
    expect(deleted).toEqual(['p/main.tex']);
  });

  it('forget unloads the open doc and drops its saved state', async () => {
    const { hocuspocus, deleted, sync } = setup();
    const doc = new Document('p/old.tex');
    hocuspocus.documents.set('p/old.tex', doc);
    await sync.forget('p', 'old.tex');
    expect(hocuspocus.documents.has('p/old.tex')).toBe(false);
    expect(doc.isDestroyed).toBe(true);
    expect(deleted).toEqual(['p/old.tex']);
  });

  it('flush writes the open doc directly instead of running the debounced store', async () => {
    const { hocuspocus, sync, saved, written, dirty } = setup();
    const doc = new Document('p/main.tex');
    doc.getText('content').insert(0, 'hello');
    hocuspocus.documents.set('p/main.tex', doc);
    let ran = false;
    // A pending debounced store, e.g. from CollabService.store, which would take the ProjectLock
    // and deadlock if flush ran it instead of writing directly.
    void hocuspocus.debouncer.debounce(
      'onStoreDocument-p/main.tex',
      async () => {
        ran = true;
      },
      60_000,
      60_000,
    );

    await sync.flush('p', 'main.tex');

    // The debounced store hook never ran; flush wrote the doc's state and text itself.
    expect(ran).toBe(false);
    expect(written.get('p/main.tex')).toBe('hello');
    expect(saved.has('p/main.tex')).toBe(true);
    const restored = new Y.Doc();
    Y.applyUpdate(restored, saved.get('p/main.tex') as Uint8Array);
    expect(restored.getText('content').toString()).toBe('hello');
    expect(dirty).toEqual(['p']);
    // The original debounce timer is left pending: it still fires later through the normal path.
    expect(hocuspocus.debouncer.isDebounced('onStoreDocument-p/main.tex')).toBe(true);
  });

  it('flush is a no-op when the doc is not open', async () => {
    const { hocuspocus, sync, written } = setup();
    await expect(sync.flush('p', 'closed.tex')).resolves.toBeUndefined();
    expect(hocuspocus.debouncer.isDebounced('onStoreDocument-p/closed.tex')).toBe(false);
    expect(written.size).toBe(0);
  });

  it('flush still writes the current live doc when nothing is pending', async () => {
    // No pending debounce timer does not prove disk already matches the doc: an earlier store
    // could still be in flight. Ctrl+S must always ship the live doc, not skip the write.
    const { hocuspocus, sync, written, saved, dirty } = setup();
    const doc = new Document('p/main.tex');
    doc.getText('content').insert(0, 'hello');
    hocuspocus.documents.set('p/main.tex', doc);
    expect(hocuspocus.debouncer.isDebounced('onStoreDocument-p/main.tex')).toBe(false);

    await sync.flush('p', 'main.tex');

    expect(written.get('p/main.tex')).toBe('hello');
    expect(saved.has('p/main.tex')).toBe(true);
    expect(dirty).toEqual(['p']);
  });
});
