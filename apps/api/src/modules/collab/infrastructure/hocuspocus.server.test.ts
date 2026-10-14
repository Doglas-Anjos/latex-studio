import { type Configuration, Document } from '@hocuspocus/server';
import { expect, it } from 'vitest';
import * as Y from 'yjs';
import type { CollabService } from '../application/collab.service';
import { createHocuspocus, MAX_STATE_BYTES } from './hocuspocus.server';

it('refuses updates past MAX_STATE_BYTES until a store measures the real size', async () => {
  const saved = Y.encodeStateAsUpdate(new Y.Doc());
  const collab = {
    parseDocumentName: () => ({ projectId: 'p', path: 'a.tex' }),
    load: async () => saved,
    store: async () => 0, // e.g. the client deleted most of the doc
  } as unknown as CollabService;
  const hooks = createHocuspocus(collab).configuration as Required<Configuration>;
  const document = new Document('p/a.tex');
  const instance = { documents: new Map([['p/a.tex', document]]) };
  // Only the size of an update matters to the hook.
  const update = (bytes: number, readOnly = false) =>
    hooks.beforeSync({
      document,
      connection: { readOnly },
      type: 2,
      payload: new Uint8Array(bytes),
    } as never);

  await hooks.onLoadDocument({ document, documentName: 'p/a.tex' } as never);
  await update(MAX_STATE_BYTES - saved.byteLength);
  await expect(update(1)).rejects.toThrow('Document too large');
  await update(1, true); // read-only: never applied, so not counted
  await hooks.onStoreDocument({ document, documentName: 'p/a.tex', instance } as never);
  await update(1);
});
