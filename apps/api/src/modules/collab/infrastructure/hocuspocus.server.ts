import { Hocuspocus } from '@hocuspocus/server';
import * as Y from 'yjs';
import type { User } from '../../users/domain/user';
import type { CollabService } from '../application/collab.service';

export const HOCUSPOCUS = Symbol('HOCUSPOCUS');

/** A single message is capped by the socket; this caps what an editor can grow a doc to. */
const MAX_DOC_CHARS = 8 * 1024 * 1024;
const MAX_PRESENCE_BYTES = 4096;
const HEX = /^#[0-9a-f]{6}$/i;

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
    // The doc is held in this process and re-encoded on every save: refuse to grow it further.
    // Throwing closes only this connection.
    async beforeHandleMessage({ document }) {
      if (document.getText('content').length > MAX_DOC_CHARS) {
        throw new Error('Document too large');
      }
    },
    // Presence comes from the verified token, not the client: no one can show up under another
    // name or id. Only the cursor and a plain colour pass through, and oversized states are dropped.
    async beforeHandleAwareness({ states, context }) {
      const user = context?.user;
      if (!user) return; // server-internal update
      for (const [clientId, state] of states) {
        if (JSON.stringify(state).length > MAX_PRESENCE_BYTES) {
          states.delete(clientId);
          continue;
        }
        const color =
          typeof state.user?.color === 'string' && HEX.test(state.user.color)
            ? state.user.color
            : undefined;
        states.set(clientId, {
          ...(state.cursor && typeof state.cursor === 'object' ? { cursor: state.cursor } : {}),
          ...(state.user
            ? {
                user: {
                  id: user.id,
                  name: user.name || user.email,
                  ...(color && { color, colorLight: `${color}33` }),
                },
              }
            : {}),
        });
      }
    },
    async onLoadDocument({ document, documentName }) {
      const { projectId, path } = collab.parseDocumentName(documentName);
      const loaded = await collab.load(projectId, path);
      if (typeof loaded === 'string') {
        document.getText('content').insert(0, loaded);
        // Saved now, not on the first edit: otherwise a restart before any edit rebuilds the doc
        // from disk with new item ids, and a client still holding the old doc merges both copies.
        await collab.saveState(projectId, path, document);
      } else Y.applyUpdate(document, loaded);
    },
    // Server-side changes (restore, format, initial load) carry no user; a throw here would
    // bring the whole API down as an unhandled rejection, so this hook never throws.
    async onChange({ context, documentName }) {
      const userId = context?.user?.id;
      if (!userId) return;
      try {
        const { projectId, path } = collab.parseDocumentName(documentName);
        await collab.recordEdit(projectId, path, userId);
      } catch {}
    },
    async onStoreDocument({ document, documentName, instance }) {
      // DocumentSync.forget dropped this doc (file renamed or deleted): never write it back.
      if (instance.documents.get(documentName) !== document) return;
      const { projectId, path } = collab.parseDocumentName(documentName);
      await collab.store(projectId, path, document);
    },
  });
}
