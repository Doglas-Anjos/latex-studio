import { create } from 'zustand';

interface WorkspaceState {
  /** null means "the project's main file". */
  activePath: string | null;
  /** Line the editor should reveal once the file is open (1-based). */
  pendingLine: number | null;
  setActivePath: (path: string | null) => void;
  goToLine: (path: string, line: number) => void;
  clearPendingLine: () => void;
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  activePath: null,
  pendingLine: null,
  setActivePath: (activePath) => set({ activePath, pendingLine: null }),
  goToLine: (activePath, pendingLine) => set({ activePath, pendingLine }),
  clearPendingLine: () => set({ pendingLine: null }),
}));
