'use client';

import { InputHTMLAttributes, forwardRef, useId } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, error, id, className = '', ...props },
  ref
) {
  const generatedId = useId();
  const inputId = id ?? generatedId;

  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label htmlFor={inputId} className="text-xs font-semibold uppercase tracking-[0.05em] text-[var(--text)]">
          {label}
        </label>
      )}
      <input
        id={inputId}
        ref={ref}
        className={`w-full rounded-lg border bg-white px-3 py-2.5 text-sm text-[var(--text)] placeholder:text-[#747878] outline-none transition focus:border-[var(--landing-text)] focus:ring-2 focus:ring-black/5 ${error ? 'border-[var(--danger)]' : 'border-[var(--landing-soft-border)]'} ${className}`}
        {...props}
      />
      {error && <p className="text-sm text-[var(--danger)]">{error}</p>}
    </div>
  );
});

