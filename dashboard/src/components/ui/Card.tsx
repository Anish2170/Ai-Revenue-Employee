import { HTMLAttributes, ReactNode } from 'react';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function Card({ children, className = '', ...props }: CardProps) {
  return (
    <div className={`rounded-xl border border-[var(--landing-soft-border)] bg-white p-6 shadow-[0_1px_2px_rgba(0,0,0,0.05)] ${className}`} {...props}>
      {children}
    </div>
  );
}

