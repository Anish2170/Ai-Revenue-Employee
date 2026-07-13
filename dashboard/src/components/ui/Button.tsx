'use client';

import { ButtonHTMLAttributes, ReactNode } from 'react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost';
  loading?: boolean;
  children: ReactNode;
}

const variantClasses: Record<string, string> = {
  primary: 'border-[var(--accent)] bg-[var(--accent)] text-white hover:opacity-90 focus-visible:outline-[var(--accent)]',
  secondary: 'border-[var(--landing-soft-border)] bg-white text-[var(--text)] hover:bg-[#f9fafb] focus-visible:outline-[var(--landing-text)]',
  ghost: 'border-transparent bg-transparent text-[var(--text-muted)] hover:bg-[var(--landing-layer)] hover:text-[var(--text)] focus-visible:outline-[var(--landing-text)]',
};

export function Button({ variant = 'primary', loading = false, disabled, className = '', children, ...props }: ButtonProps) {
  return (
    <button
      disabled={disabled || loading}
      className={`inline-flex w-full items-center justify-center gap-2 rounded-lg border px-4 py-2.5 text-xs font-semibold tracking-[0.05em] transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-60 ${variantClasses[variant]} ${className}`}
      {...props}
    >
      {loading && (
        <svg className="h-4 w-4 animate-spin text-current" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
        </svg>
      )}
      {children}
    </button>
  );
}

