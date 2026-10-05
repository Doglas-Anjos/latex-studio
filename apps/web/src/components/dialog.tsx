import { X } from 'lucide-react';
import type { ReactNode, RefObject } from 'react';
import { Button } from './button';

/** Native <dialog>; the parent opens it with ref.current?.showModal(). */
export function Dialog({
  ref,
  title,
  icon,
  kicker,
  description,
  tone,
  pending,
  footer,
  children,
}: {
  ref: RefObject<HTMLDialogElement | null>;
  title: string;
  /** Small badge illustrating the action, shown left of the title. */
  icon?: ReactNode;
  /** Short label above the title giving context, e.g. the target path. */
  kicker?: ReactNode;
  /** Explanatory copy shown under the title, above the body content. */
  description?: ReactNode;
  /** Tints the icon badge and kicker for a destructive action. */
  tone?: 'danger';
  /** While true, blocks the Escape key and the X from closing the dialog mid-mutation. */
  pending?: boolean;
  /** Actions pinned below the scrollable body; stay visible without scrolling. */
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <dialog
      ref={ref}
      className="dialog"
      data-tone={tone}
      aria-label={title}
      onCancel={(e) => {
        if (pending) e.preventDefault();
      }}
    >
      <div className="dialog-header">
        <div className="dialog-header-main">
          {icon && (
            <span className="dialog-icon" aria-hidden="true">
              {icon}
            </span>
          )}
          <div className="dialog-heading">
            {kicker && <p className="dialog-kicker">{kicker}</p>}
            <h2>{title}</h2>
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="dialog-close"
          aria-label="Fechar"
          disabled={pending}
          onClick={() => ref.current?.close()}
        >
          <X size={16} aria-hidden="true" />
        </Button>
      </div>
      <div className="dialog-body">
        {description && <p className="dialog-description">{description}</p>}
        {children}
      </div>
      {footer && <div className="dialog-footer">{footer}</div>}
    </dialog>
  );
}
