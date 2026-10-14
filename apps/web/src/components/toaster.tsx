import { X } from 'lucide-react';
import { createPortal } from 'react-dom';
import { useToasts } from '../toast-store';

/**
 * The toasts, bottom right. While a modal <dialog> is open everything outside it is inert and
 * painted under its backdrop, so the list is rendered inside that dialog instead: still visible,
 * clickable and announced. Picked on each render, i.e. whenever a toast comes or goes.
 */
export function Toaster() {
  const { toasts, dismiss } = useToasts();
  if (toasts.length === 0) return null;
  const host = document.querySelector<HTMLDialogElement>('dialog[open]') ?? document.body;
  return createPortal(
    <section className="toaster" aria-label="Notificações">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="toast"
          data-tone={t.tone}
          role={t.tone === 'error' ? 'alert' : 'status'}
        >
          <span>{t.message}</span>
          <button
            type="button"
            className="toast-close"
            aria-label="Fechar aviso"
            onClick={() => dismiss(t.id)}
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      ))}
    </section>,
    host,
  );
}
