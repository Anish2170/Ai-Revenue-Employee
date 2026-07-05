'use client';

import { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';

// ---------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
type ButtonSize = 'sm' | 'md';

interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'size'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  children: ReactNode;
}

const buttonVariantStyles: Record<ButtonVariant, { background: string; color: string; border: string }> = {
  primary: { background: 'var(--accent)', color: '#ffffff', border: 'var(--accent)' },
  secondary: { background: 'var(--bg-input)', color: 'var(--text)', border: 'var(--border)' },
  danger: { background: 'var(--danger)', color: '#ffffff', border: 'var(--danger)' },
  ghost: { background: 'transparent', color: 'var(--text)', border: 'transparent' },
};

const buttonSizeStyles: Record<ButtonSize, string> = {
  sm: 'text-sm px-3 py-1.5',
  md: 'text-sm px-4 py-2.5',
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
  const styles = buttonVariantStyles[variant];
  const isDisabled = disabled || loading;

  return (
    <button
      disabled={isDisabled}
      className={`inline-flex items-center justify-center gap-2 rounded-lg font-medium border transition-opacity ${buttonSizeStyles[size]} ${
        isDisabled ? 'opacity-50 cursor-not-allowed' : 'hover:opacity-90 cursor-pointer'
      } ${className}`}
      style={{
        background: styles.background,
        color: styles.color,
        borderColor: styles.border,
      }}
      {...props}
    >
      {loading && <Spinner className="h-4 w-4" />}
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export function Input({ label, error, className = '', id, ...props }: InputProps) {
  const inputId = id || props.name;

  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label htmlFor={inputId} className="text-sm font-medium" style={{ color: 'var(--text)' }}>
          {label}
        </label>
      )}
      <input
        id={inputId}
        className={`rounded-lg border px-3 py-2.5 text-sm outline-none transition-colors focus:ring-2 ${className}`}
        style={{
          background: 'var(--bg-input)',
          borderColor: error ? 'var(--danger)' : 'var(--border)',
          color: 'var(--text)',
        }}
        {...props}
      />
      {error && (
        <span className="text-xs" style={{ color: 'var(--danger)' }}>
          {error}
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  className?: string;
}

export function Card({ children, className = '', ...props }: CardProps) {
  return (
    <div
      className={`rounded-xl border p-6 ${className}`}
      style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}
      {...props}
    >
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Badge
// ---------------------------------------------------------------------------

type BadgeVariant = 'success' | 'warning' | 'danger' | 'neutral';

interface BadgeProps {
  variant?: BadgeVariant;
  children: ReactNode;
}

const badgeVariantStyles: Record<BadgeVariant, { background: string; color: string }> = {
  success: { background: 'rgba(34, 197, 94, 0.15)', color: 'var(--success)' },
  warning: { background: 'rgba(245, 158, 11, 0.15)', color: 'var(--warning)' },
  danger: { background: 'rgba(239, 68, 68, 0.15)', color: 'var(--danger)' },
  neutral: { background: 'var(--bg-input)', color: 'var(--text-muted)' },
};

export function Badge({ variant = 'neutral', children }: BadgeProps) {
  const styles = badgeVariantStyles[variant];
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium"
      style={{ background: styles.background, color: styles.color }}
    >
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Spinner
// ---------------------------------------------------------------------------

interface SpinnerProps {
  className?: string;
}

export function Spinner({ className = 'h-5 w-5' }: SpinnerProps) {
  return (
    <svg
      className={`animate-spin ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// EmptyState
// ---------------------------------------------------------------------------

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-16 px-4">
      {icon && (
        <div className="mb-4" style={{ color: 'var(--text-muted)' }}>
          {icon}
        </div>
      )}
      <h3 className="text-base font-semibold" style={{ color: 'var(--text)' }}>
        {title}
      </h3>
      {description && (
        <p className="mt-1.5 text-sm max-w-sm" style={{ color: 'var(--text-muted)' }}>
          {description}
        </p>
      )}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}
