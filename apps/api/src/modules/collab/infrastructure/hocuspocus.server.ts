import { Hocuspocus } from '@hocuspocus/server';
import * as Y from 'yjs';
import type { User } from '../../users/domain/user';
import type { CollabService } from '../application/collab.service';

export const HOCUSPOCUS = Symbol('HOCUSPOCUS');

/** One Y.Doc per text file, named `<projectId>/<path>`; the text lives in `getText('content')`. */
export function createHocuspocus(collab: CollabService): Hocuspocus<{ user: User }> {
  return new Hocuspocus<{ user: User }>({
    debounce: 2000,
    maxDebounce: 10000,
    // Throwing refuses the document; the token is never logged.
    async onAuthenticate({ request, documentName, connectionConfig, token }) {
      const session = await collab.authenticate({
        token,
        origin: request.headers.get('origin'),
        host: request.headers.get('host'),
        documentName,
      });
      connectionConfig.readOnly = session.readOnly;
      return { user: session.user };
    },
    async onLoadDocument({ document, documentName }) {
      const { projectId, path } = collab.parseDocumentName(documentName);
      const loaded = await collab.load(projectId, path);
      if (typeof loaded === 'string') document.getText('content').insert(0, loaded);
      else Y.applyUpdate(document, loaded);
    },
    async onStoreDocument({ document, documentName, instance }) {
      // DocumentSync.forget dropped this doc (file renamed or deleted): never write it back.
      if (instance.documents.get(documentName) !== document) return;
      const { projectId, path } = collab.parseDocumentName(documentName);
      await collab.store(projectId, path, document);
    },
  });
}
