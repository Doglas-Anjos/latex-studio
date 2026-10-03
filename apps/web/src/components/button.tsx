import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';

export function Button({
  variant,
  className,
  ...props
}: { variant: Variant } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={`btn btn-${variant}${className ? ` ${className}` : ''}`}
      {...props}
    />
  );
}
