import { HocuspocusProvider } from '@hocuspocus/provider';
import * as Y from 'yjs';
import { type Connection, useWorkspaceStore } from '../workspace-store';

const unsynced = new Set<object>();
const confirmLeave = (e: BeforeUnloadEvent) => e.preventDefault();
/** One beforeunload prompt, registered only while some editor holds edits the server lacks. */
export function markUnsynced(provider: object, dirty: boolean) {
  const before = unsynced.size;
  if (dirty) unsynced.add(provider);
  else unsynced.delete(provider);
  if (!before && unsynced.size) window.addEventListener('beforeunload', confirmLeave);
  if (before && !unsynced.size) window.removeEventListener('beforeunload', confirmLeave);
}

type Closable = Pick<HocuspocusProvider, 'hasUnsyncedChanges' | 'on' | 'destroy'>;
/** Destroys provider and doc once the last local edit reached the server, or after 5 s. */
export function closeWhenSynced(provider: Closable, doc: Pick<Y.Doc, 'destroy'>) {
  let done = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const finish = () => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    markUnsynced(provider, false);
    provider.destroy();
    doc.destroy();
  };
  if (!provider.hasUnsyncedChanges) return finish();
  provider.on('unsyncedChanges', ({ number }: { number: number }) => number === 0 && finish());
  timer = setTimeout(finish, 5000);
}

/**
 * The live document behind an open text tab: Y.Doc, websocket provider and undo history. It
 * outlives the editor view, so switching back to a tab shows its text at once instead of
 * reconnecting, re-authenticating and re-syncing the whole state; cursor and scroll come back too.
 */
export interface CollabSession {
  key: string;
  projectId: string;
  path: string;
  doc: Y.Doc;
  ytext: Y.Text;
  provider: HocuspocusProvider;
  undo: Y.UndoManager;
  status: Connection;
  /** Where the person was when they left the tab; restored when the view is rebuilt. */
  parked: { selection: unknown; scrollTop: number; length: number } | null;
}

/** Open tabs beyond this many reconnect when revisited; each kept session holds a websocket. */
const MAX_SESSIONS = 8;
const sessions = new Map<string, CollabSession>();
let active: string | null = null;
let currentProject: string | null = null;

/** The session for `projectId/path`, created (and connecting) on first use. */
export function openSession(
  projectId: string,
  path: string,
  token: () => Promise<string>,
): CollabSession {
  const key = `${projectId}/${path}`;
  active = key;
  currentProject = projectId;
  const found = sessions.get(key);
  if (found) {
    // Most recently used goes last, so eviction takes the oldest.
    sessions.delete(key);
    sessions.set(key, found);
    useWorkspaceStore.getState().setConnection(found.status);
    return found;
  }
  const doc = new Y.Doc();
  const ytext = doc.getText('content');
  const session: CollabSession = {
    key,
    projectId,
    path,
    doc,
    ytext,
    provider: new HocuspocusProvider({
      url: `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/collab`,
      name: key,
      document: doc,
      token,
      // Only the tab on screen drives the status bar.
      onStatus: ({ status }) => {
        session.status = status as Connection;
        if (active === key) useWorkspaceStore.getState().setConnection(session.status);
      },
    }),
    undo: new Y.UndoManager(ytext),
    status: 'connecting',
    parked: null,
  };
  session.provider.on('unsyncedChanges', ({ number }: { number: number }) =>
    markUnsynced(session.provider, number > 0),
  );
  sessions.set(key, session);
  useWorkspaceStore.getState().setConnection('connecting');
  for (const k of sessions.keys()) {
    if (sessions.size <= MAX_SESSIONS) break;
    if (k !== key) closeSession(k);
  }
  return session;
}

/** Ends a session once its last local edit reached the server. */
export function closeSession(key: string) {
  const session = sessions.get(key);
  if (!session) return;
  sessions.delete(key);
  if (active === key) active = null;
  session.undo.destroy();
  closeWhenSynced(session.provider, session.doc);
}

/** Forgets a session whose file vanished; the caller keeps its frozen text on screen. */
export function dropSession(key: string) {
  const session = sessions.get(key);
  if (!session) return;
  sessions.delete(key);
  if (active === key) active = null;
  session.provider.disconnect();
  markUnsynced(session.provider, false);
}

export const isOpenSession = (session: CollabSession) => sessions.get(session.key) === session;

// A closed tab (or a project switch, which empties the tabs) ends its session. Deferred one task so
// the editor view bound to it has unmounted first.
useWorkspaceStore.subscribe((s, prev) => {
  if (s.tabs === prev.tabs) return;
  setTimeout(() => {
    const open = new Set(
      useWorkspaceStore
        .getState()
        .tabs.filter((t) => t.kind === 'file')
        .map((t) => t.path),
    );
    for (const session of [...sessions.values()]) {
      if (session.projectId !== currentProject || !open.has(session.path)) {
        closeSession(session.key);
      }
    }
  });
});
