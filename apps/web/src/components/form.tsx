import { type FormHTMLAttributes, type InputHTMLAttributes, type ReactNode, useId } from 'react';

export function Form({ children, ...props }: FormHTMLAttributes<HTMLFormElement>) {
  return (
    <form className="form" {...props}>
      {children}
    </form>
  );
}

function Field({
  label,
  ...input
}: { label: string } & Omit<InputHTMLAttributes<HTMLInputElement>, 'id'>) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} {...input} />
    </div>
  );
}

function FormError({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="form-error">
      {children}
    </p>
  );
}

Form.Field = Field;
Form.Error = FormError;
