import { create } from 'zustand';

export interface Toast {
  id: number;
  message: string;
  tone: 'error' | 'info';
}

/** Transient notices (Zustand: UI state), shown by <Toaster />. */
export const useToasts = create<{ toasts: Toast[]; dismiss: (id: number) => void }>((set) => ({
  toasts: [],
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

let next = 0;
/** Shows `message` for a few seconds; errors stay longer. At most three at a time. */
export function toast(message: string, tone: Toast['tone'] = 'error') {
  const id = ++next;
  useToasts.setState((s) => ({ toasts: [...s.toasts, { id, message, tone }].slice(-3) }));
  setTimeout(() => useToasts.getState().dismiss(id), tone === 'error' ? 8000 : 4000);
}
