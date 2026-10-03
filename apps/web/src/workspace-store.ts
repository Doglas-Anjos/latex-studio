import { create } from 'zustand';

/** Current editor selection, expressed as Yjs relative positions (base64). */
export interface SelectionAnchor {
  anchor: { start: string; end: string };
  quote: string;
  line: number;
}

interface WorkspaceState {
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

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  activePath: null,
  pendingLine: null,
  getSelection: null,
  activeCommentId: null,
  commentJump: null,
  setActivePath: (activePath) => set({ activePath, pendingLine: null, activeCommentId: null }),
  goToLine: (activePath, pendingLine) => set({ activePath, pendingLine }),
  clearPendingLine: () => set({ pendingLine: null }),
  setSelectionProvider: (getSelection) => set({ getSelection }),
  setActiveComment: (activeCommentId) => set({ activeCommentId }),
  revealComment: (id) => set({ activeCommentId: id, commentJump: { id } }),
}));
