import type { ReactNode } from 'react';
import { useEffect, useRef } from 'react';

/** Disclosure dropdown: closes on Escape, on an outside click, and after any item inside is clicked. */
export function Menu({
  label,
  triggerClassName,
  className,
  children,
}: {
  label: ReactNode;
  triggerClassName?: string;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  const summaryRef = useRef<HTMLElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    const list = listRef.current;
    if (!el || !list) return;
    const close = () => el.removeAttribute('open');
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && el.open) {
        close();
        summaryRef.current?.focus();
      }
    };
    const onOutsideClick = (e: MouseEvent) => {
      if (el.open && !el.contains(e.target as Node)) close();
    };
    const onListClick = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest('[disabled], [aria-disabled="true"]')) return;
      close();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('click', onOutsideClick);
    list.addEventListener('click', onListClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('click', onOutsideClick);
      list.removeEventListener('click', onListClick);
    };
  }, []);
  return (
    <details ref={ref} className={`menu${className ? ` ${className}` : ''}`}>
      <summary ref={summaryRef} className={triggerClassName}>
        {label}
      </summary>
      <div className="menu-list" ref={listRef}>
        {children}
      </div>
    </details>
  );
}
