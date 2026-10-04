import type { ReactNode, RefObject } from 'react';

/** Native <dialog>; the parent opens it with ref.current?.showModal(). */
export function Dialog({
  ref,
  title,
  pending,
  children,
}: {
  ref: RefObject<HTMLDialogElement | null>;
  title: string;
  /** While true, blocks the Escape key from closing the dialog mid-mutation. */
  pending?: boolean;
  children: ReactNode;
}) {
  return (
    <dialog
      ref={ref}
      className="dialog"
      aria-label={title}
      onCancel={(e) => {
        if (pending) e.preventDefault();
      }}
    >
      <h2>{title}</h2>
      {children}
    </dialog>
  );
}
