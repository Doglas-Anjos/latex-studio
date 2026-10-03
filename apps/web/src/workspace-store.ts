import { create } from 'zustand';

/** Current editor selection, expressed as Yjs relative positions (base64). */
export interface SelectionAnchor {
  anchor: { start: string; end: string };
  quote: string;
  line: number;
}

export type Tab =
  | { id: string; kind: 'file'; path: string }
  | { id: string; kind: 'diff'; path: string; from: string; to: string };
type NewTab =
  | Omit<Extract<Tab, { kind: 'file' }>, 'id'>
  | Omit<Extract<Tab, { kind: 'diff' }>, 'id'>;
export type Connection = 'connecting' | 'connected' | 'disconnected';
export interface Peer {
  name: string;
  color: string;
}
interface EditorCommands {
  indentAll: () => void;
}

const tabId = (t: NewTab) =>
  t.kind === 'file' ? `file:${t.path}` : `diff:${t.path}:${t.from}:${t.to}`;

interface WorkspaceState {
  tabs: Tab[];
  activeTabId: string | null;
  openTab: (tab: NewTab) => void;
  closeTab: (id: string) => void;
  connection: Connection;
  setConnection: (c: Connection) => void;
  wordCount: number | null;
  setWordCount: (n: number | null) => void;
  editorCommands: EditorCommands | null;
  setEditorCommands: (c: EditorCommands | null) => void;
  peers: Peer[];
  setPeers: (p: Peer[]) => void;
  /** null means "the project's main file". */
  activePath: string | null;
  /** Line the editor should reveal once the file is open (1-based). */
  pendingLine: number | null;
  /** Set by the open editor; null when no collaborative editor is mounted. */
  getSelection: (() => SelectionAnchor | null) | null;
  activeCommentId: string | null;
  /** New object per request so the editor scrolls even when the same comment is clicked twice. */
  commentJump: { id: string } | null;
  setActivePath: (path: string | null) => void;
  goToLine: (path: string, line: number) => void;
  clearPendingLine: () => void;
  setSelectionProvider: (fn: (() => SelectionAnchor | null) | null) => void;
  /** Mark a comment active without moving the editor (click on a highlight). */
  setActiveComment: (id: string | null) => void;
  /** Mark a comment active and scroll the editor to it. */
  revealComment: (id: string) => void;
}

/** Tab list + active ids after opening a tab; activePath follows an active file tab. */
function opened(s: WorkspaceState, tab: NewTab) {
  const id = tabId(tab);
  const tabs = s.tabs.some((t) => t.id === id) ? s.tabs : [...s.tabs, { ...tab, id } as Tab];
  return { tabs, activeTabId: id, ...(tab.kind === 'file' ? { activePath: tab.path } : {}) };
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  tabs: [],
  activeTabId: null,
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
  connection: 'connecting',
  setConnection: (connection) => set({ connection }),
  wordCount: null,
  setWordCount: (wordCount) => set({ wordCount }),
  editorCommands: null,
  setEditorCommands: (editorCommands) => set({ editorCommands }),
  peers: [],
  setPeers: (peers) => set({ peers }),
  activePath: null,
  pendingLine: null,
  getSelection: null,
  activeCommentId: null,
  commentJump: null,
  setActivePath: (path) =>
    set((s) => ({
      pendingLine: null,
      activeCommentId: null,
      ...(path === null ? { activePath: null } : opened(s, { kind: 'file', path })),
    })),
  goToLine: (path, pendingLine) =>
    set((s) => ({ pendingLine, ...opened(s, { kind: 'file', path }) })),
  clearPendingLine: () => set({ pendingLine: null }),
  setSelectionProvider: (getSelection) => set({ getSelection }),
  setActiveComment: (activeCommentId) => set({ activeCommentId }),
  revealComment: (id) => set({ activeCommentId: id, commentJump: { id } }),
}));
