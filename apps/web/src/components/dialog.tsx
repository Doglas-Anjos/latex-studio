import type { ReactNode, RefObject } from 'react';

/** Native <dialog>; the parent opens it with ref.current?.showModal(). */
export function Dialog({
  ref,
  title,
  children,
}: {
  ref: RefObject<HTMLDialogElement | null>;
  title: string;
  children: ReactNode;
}) {
  return (
    <dialog ref={ref} className="dialog" aria-label={title}>
      <h2>{title}</h2>
      {children}
    </dialog>
  );
}
