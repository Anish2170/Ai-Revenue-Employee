'use client';

import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { Button } from '@/components/ui';

const NAV_LINKS = [
  { href: '/analytics', label: 'Analytics' },
  { href: '/websites', label: 'Websites' },
  { href: '/settings', label: 'Settings' },
];

export default function DashboardLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const { user, logout } = useAuth();

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg)' }}>
      <aside
        className="fixed left-0 top-0 h-screen w-64 flex flex-col border-r"
        style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}
      >
        <div className="px-6 py-5 border-b" style={{ borderColor: 'var(--border)' }}>
          <span className="text-lg font-semibold" style={{ color: 'var(--text)' }}>
            AI Revenue Employee
          </span>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="block rounded-lg px-3 py-2 text-sm font-medium transition-colors"
              style={{ color: 'var(--text-muted)' }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--bg-input)';
                e.currentTarget.style.color = 'var(--text)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.color = 'var(--text-muted)';
              }}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="px-4 py-4 border-t space-y-3" style={{ borderColor: 'var(--border)' }}>
          <div className="text-sm truncate" style={{ color: 'var(--text)' }}>
            {user?.name}
          </div>
          <Button variant="secondary" size="sm" onClick={() => logout()}>
            Log out
          </Button>
        </div>
      </aside>

      <main className="ml-64 p-8">{children}</main>
    </div>
  );
}
