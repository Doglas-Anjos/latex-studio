import { X } from 'lucide-react';
import { createContext, type ReactNode, type RefObject, use } from 'react';
import { Button } from './button';

const DialogContext = createContext<{
  ref: RefObject<HTMLDialogElement | null>;
  pending?: boolean | undefined;
}>({ ref: { current: null } });

/** Native <dialog>; the parent opens it with ref.current?.showModal(). */
export function Dialog({
  ref,
  title,
  icon,
  kicker,
  description,
  tone,
  pending,
  wide,
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
  pending?: boolean | undefined;
  /** Editors and tools (formula, table) that need room, not a short form. */
  wide?: boolean;
  /** Actions pinned below the scrollable body; stay visible without scrolling. */
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <DialogContext value={{ ref, pending }}>
      <dialog
        ref={ref}
        className="dialog"
        data-tone={tone}
        data-wide={wide || undefined}
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
    </DialogContext>
  );
}

/** Footer cancel button: closes the enclosing Dialog, disabled while it is pending. */
function Cancel() {
  const { ref, pending } = use(DialogContext);
  return (
    <Button variant="ghost" onClick={() => ref.current?.close()} disabled={pending}>
      Cancelar
    </Button>
  );
}

Dialog.Cancel = Cancel;
