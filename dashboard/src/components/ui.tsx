'use client';

import { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
type ButtonSize = 'sm' | 'md';

interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'size'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  children: ReactNode;
}

const buttonVariantClasses: Record<ButtonVariant, string> = {
  primary: 'border-[var(--accent)] bg-[var(--accent)] text-white hover:opacity-90 focus-visible:outline-[var(--accent)]',
  secondary: 'border-[var(--landing-soft-border)] bg-white text-[var(--text)] hover:bg-[#f9fafb] focus-visible:outline-[var(--landing-text)]',
  danger: 'border-[var(--danger)] bg-[var(--danger)] text-white hover:opacity-90 focus-visible:outline-[var(--danger)]',
  ghost: 'border-transparent bg-transparent text-[var(--text-muted)] hover:bg-[var(--landing-layer)] hover:text-[var(--text)] focus-visible:outline-[var(--landing-text)]',
};

const buttonSizeClasses: Record<ButtonSize, string> = {
  sm: 'min-h-8 px-3 py-1.5 text-xs',
  md: 'min-h-10 px-4 py-2.5 text-xs',
};

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  children,
  className = '',
  ...props
}: ButtonProps) {
  const isDisabled = disabled || loading;

  return (
    <button
      disabled={isDisabled}
      className={`inline-flex items-center justify-center gap-2 rounded-lg border font-semibold tracking-[0.05em] transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-60 ${buttonSizeClasses[size]} ${buttonVariantClasses[variant]} ${className}`}
      {...props}
    >
      {loading && <Spinner className="h-4 w-4" />}
      {children}
    </button>
  );
}

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export function Input({ label, error, className = '', id, ...props }: InputProps) {
  const inputId = id || props.name;

  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label htmlFor={inputId} className="text-xs font-semibold uppercase tracking-[0.05em] text-[var(--text)]">
          {label}
        </label>
      )}
      <input
        id={inputId}
        className={`min-h-11 rounded-lg border bg-white px-3 py-2.5 text-sm text-[var(--text)] outline-none transition placeholder:text-[#747878] focus:border-[var(--landing-text)] focus:ring-2 focus:ring-black/5 ${error ? 'border-[var(--danger)]' : 'border-[var(--landing-soft-border)]'} ${className}`}
        {...props}
      />
      {error && <span className="text-xs text-[var(--danger)]">{error}</span>}
    </div>
  );
}

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  className?: string;
}

export function Card({ children, className = '', ...props }: CardProps) {
  return (
    <div
      className={`rounded-xl border border-[var(--landing-soft-border)] bg-white p-6 shadow-[0_1px_2px_rgba(0,0,0,0.05)] ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}

type BadgeVariant = 'success' | 'warning' | 'danger' | 'neutral';

interface BadgeProps {
  variant?: BadgeVariant;
  children: ReactNode;
}

const badgeVariantClasses: Record<BadgeVariant, string> = {
  success: 'border-[rgba(34,197,94,0.28)] bg-[rgba(34,197,94,0.12)] text-[var(--success)]',
  warning: 'border-[rgba(245,158,11,0.32)] bg-[rgba(245,158,11,0.13)] text-[var(--warning)]',
  danger: 'border-[rgba(239,68,68,0.26)] bg-[rgba(239,68,68,0.11)] text-[var(--danger)]',
  neutral: 'border-[var(--landing-soft-border)] bg-[var(--landing-layer-low)] text-[var(--text-muted)]',
};

export function Badge({ variant = 'neutral', children }: BadgeProps) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.05em] ${badgeVariantClasses[variant]}`}>
      {children}
    </span>
  );
}

interface SpinnerProps {
  className?: string;
}

export function Spinner({ className = 'h-5 w-5' }: SpinnerProps) {
  return (
    <svg className={`animate-spin text-[var(--accent)] ${className}`} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-[var(--landing-soft-border)] bg-[var(--landing-layer-low)] px-4 py-14 text-center">
      {icon && <div className="mb-4 text-[var(--landing-brass)]">{icon}</div>}
      <h3 className="text-base font-semibold text-[var(--text)]">{title}</h3>
      {description && <p className="mt-2 max-w-sm text-sm text-[var(--text-muted)]">{description}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

