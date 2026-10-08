import { create } from 'zustand';
import type { CommentScope } from './comment-scope';

/**
 * A comment target captured at the moment the user asks to comment (from the
 * editor's contextual action, margin button or keyboard shortcut) — not
 * re-read from the editor on submit, so it survives the user moving focus to
 * the comment panel. `valid` is false when the scope had nothing to anchor
 * to (e.g. "word" with the cursor in whitespace); `reason` explains why.
 */
export type CommentDraft =
  | {
      valid: true;
      path: string;
      scope: CommentScope;
      anchor: { start: string; end: string };
      quote: string;
      line: number;
      endLine: number;
    }
  | {
      valid: false;
      path: string;
      scope: CommentScope;
      reason: string;
    };

export type Tab =
  | { id: string; kind: 'file'; path: string }
  | { id: string; kind: 'diff'; path: string; from: string; to: string };
type NewTab =
  | Omit<Extract<Tab, { kind: 'file' }>, 'id'>
  | Omit<Extract<Tab, { kind: 'diff' }>, 'id'>;
export type Connection = 'connecting' | 'connected' | 'disconnected';
export interface Peer {
  /** Awareness clientID: two tabs of the same user are two peers. */
  id: number;
  name: string;
  color: string;
}
interface EditorCommands {
  indentAll: () => void;
  /** Replaces the document with `text` as minimal edits (collaborators keep their cursors). */
  applyText: (text: string) => void;
  getText: () => string;
}

const tabId = (t: NewTab) =>
  t.kind === 'file' ? `file:${t.path}` : `diff:${t.path}:${t.from}:${t.to}`;

interface WorkspaceState {
  tabs: Tab[];
  activeTabId: string | null;
  openTab: (tab: NewTab) => void;
  closeTab: (id: string) => void;
  /** Closes every tab on `path` or inside the folder `path` (deleted or renamed). */
  closeTabsUnder: (path: string) => void;
  /** Back to a blank workspace; called when a project is entered. */
  reset: () => void;
  /** Bumped on each local user edit (typing, delete, undo/redo); the auto-compile signal. */
  docVersion: number;
  bumpDocVersion: () => void;
  connection: Connection;
  setConnection: (c: Connection) => void;
  wordCount: number | null;
  setWordCount: (n: number | null) => void;
  editorCommands: EditorCommands | null;
  setEditorCommands: (c: EditorCommands | null) => void;
  peers: Peer[];
  setPeers: (p: Peer[]) => void;
  blameOn: boolean;
  toggleBlame: () => void;
  /** null means "the project's main file". */
  activePath: string | null;
  historyScope: 'project' | 'file';
  setHistoryScope: (scope: 'project' | 'file') => void;
  /** Line the editor should reveal once the file is open (1-based). */
  pendingLine: number | null;
  /** Snapshot of the comment the user asked to write, or null once sent/cancelled. */
  commentDraft: CommentDraft | null;
  setCommentDraft: (draft: CommentDraft | null) => void;
  /**
   * Set by the open collaborative editor: true if the draft's anchor still
   * resolves in the live document (collaborative edits may have removed it).
   * Null when no collaborative editor is mounted for the draft's file.
   */
  checkCommentAnchor: ((anchor: { start: string; end: string }) => boolean) | null;
  setCheckCommentAnchor: (fn: ((anchor: { start: string; end: string }) => boolean) | null) => void;
  activeCommentId: string | null;
  /** New object per request so the editor scrolls even when the same comment is clicked twice. */
  commentJump: { id: string } | null;
  setActivePath: (path: string | null) => void;
  goToLine: (path: string, line: number) => void;
  clearPendingLine: () => void;
  /** Mark a comment active without moving the editor (click on a highlight). */
  setActiveComment: (id: string | null) => void;
  /** Mark a comment active and scroll the editor to it. */
  revealComment: (id: string) => void;
  /** Open the comments panel on a comment (double click); `edit` opens its text for editing. */
  commentFocus: { id: string; edit: boolean; at: number } | null;
  focusComment: (id: string, edit?: boolean) => void;
  /** Right-click menu on a comment highlight, in viewport coordinates. */
  commentMenu: { id: string; x: number; y: number } | null;
  setCommentMenu: (menu: { id: string; x: number; y: number } | null) => void;
}

/** Tab list + active ids after opening a tab; activePath follows an active file tab. */
function opened(s: WorkspaceState, tab: NewTab) {
  const id = tabId(tab);
  const tabs = s.tabs.some((t) => t.id === id) ? s.tabs : [...s.tabs, { ...tab, id } as Tab];
  return { tabs, activeTabId: id, ...(tab.kind === 'file' ? { activePath: tab.path } : {}) };
}

const initial = {
  tabs: [] as Tab[],
  activeTabId: null,
  docVersion: 0,
  connection: 'connecting' as Connection,
  wordCount: null,
  editorCommands: null,
  peers: [] as Peer[],
  blameOn: false,
  activePath: null,
  historyScope: 'project' as const,
  pendingLine: null,
  commentDraft: null,
  checkCommentAnchor: null,
  activeCommentId: null,
  commentJump: null,
  commentFocus: null,
  commentMenu: null,
} satisfies Partial<WorkspaceState>;

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  ...initial,
  reset: () => set(initial),
  bumpDocVersion: () => set((s) => ({ docVersion: s.docVersion + 1 })),
  closeTabsUnder: (path) =>
    set((s) => {
      const under = (p: string | null) => p !== null && (p === path || p.startsWith(`${path}/`));
      const tabs = s.tabs.filter((t) => !under(t.path));
      const activeGone = !tabs.some((t) => t.id === s.activeTabId);
      const next = activeGone ? (tabs.at(-1) ?? null) : null;
      return {
        tabs,
        ...(activeGone ? { activeTabId: next?.id ?? null } : {}),
        ...(under(s.activePath) || activeGone
          ? { activePath: next?.kind === 'file' ? next.path : null }
          : {}),
      };
    }),
  openTab: (tab) => set((s) => opened(s, tab)),
  closeTab: (id) =>
    set((s) => {
      const i = s.tabs.findIndex((t) => t.id === id);
      if (i < 0) return {};
      const tabs = s.tabs.filter((t) => t.id !== id);
      if (s.activeTabId !== id) return { tabs };
      const next = tabs[i - 1] ?? tabs[i] ?? null;
      return {
        tabs,
        activeTabId: next?.id ?? null,
        activePath: next ? (next.kind === 'file' ? next.path : s.activePath) : null,
      };
    }),
  setConnection: (connection) => set({ connection }),
  setWordCount: (wordCount) => set({ wordCount }),
  setEditorCommands: (editorCommands) => set({ editorCommands }),
  setPeers: (peers) =>
    set((s) =>
      s.peers.length === peers.length &&
      s.peers.every((p, i) => {
        const q = peers[i];
        return q && p.id === q.id && p.name === q.name && p.color === q.color;
      })
        ? s
        : { peers },
    ),
  toggleBlame: () => set((s) => ({ blameOn: !s.blameOn })),
  setHistoryScope: (historyScope) => set({ historyScope }),
  setCommentDraft: (commentDraft) => set({ commentDraft }),
  setCheckCommentAnchor: (checkCommentAnchor) => set({ checkCommentAnchor }),
  setActivePath: (path) =>
    set((s) => ({
      pendingLine: null,
      activeCommentId: null,
      ...(path === null ? { activePath: null } : opened(s, { kind: 'file', path })),
    })),
  goToLine: (path, pendingLine) =>
    set((s) => ({ pendingLine, ...opened(s, { kind: 'file', path }) })),
  clearPendingLine: () => set({ pendingLine: null }),
  setActiveComment: (activeCommentId) => set({ activeCommentId }),
  revealComment: (id) => set({ activeCommentId: id, commentJump: { id } }),
  focusComment: (id, edit = false) =>
    set({ activeCommentId: id, commentMenu: null, commentFocus: { id, edit, at: Date.now() } }),
  setCommentMenu: (commentMenu) => set({ commentMenu }),
}));
