import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';
type Size = 'default' | 'compact' | 'icon';

export function Button({
  variant,
  size = 'default',
  loading,
  className,
  disabled,
  children,
  ...props
}: {
  variant: Variant;
  size?: Size;
  loading?: boolean;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...props}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`btn btn-${variant}${size !== 'default' ? ` btn-${size}` : ''}${className ? ` ${className}` : ''}`}
    >
      {loading && <span className="btn-spinner" aria-hidden="true" />}
      {children}
    </button>
  );
}
