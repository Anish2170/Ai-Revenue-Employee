'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { Button } from '@/components/ui';

const NAV_LINKS = [
  { href: '/analytics', label: 'Analytics', icon: 'insights' },
  { href: '/leads', label: 'Leads', icon: 'person_add' },
  { href: '/websites', label: 'Websites', icon: 'language' },
  { href: '/onboarding', label: 'Guided Setup', icon: 'route' },
  { href: '/website-actions', label: 'Website Actions', icon: 'ads_click' },
  { href: '/ai-decision-log', label: 'AI Decision Log', icon: 'psychology' },
  { href: '/knowledge-debug', label: 'Knowledge Debug', icon: 'search_check' },
  { href: '/settings', label: 'Settings', icon: 'settings' },
];

function Icon({ children }: { children: string }) {
  return <span className="material-symbols-outlined text-[19px]" aria-hidden="true">{children}</span>;
}

export default function DashboardLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const { user, logout } = useAuth();
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text)]">
      <aside className="fixed left-0 top-0 z-40 hidden h-screen w-72 flex-col border-r border-[var(--border)] bg-[var(--landing-surface)] lg:flex">
        <div className="border-b border-[var(--border)] px-6 py-5">
          <Link href="/websites" className="flex items-center gap-3 text-[var(--text)] no-underline">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--accent)] text-xs font-bold text-white">AI</span>
            <span className="text-lg font-semibold tracking-[-0.01em]">AI Revenue Employee</span>
          </Link>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-4" aria-label="Product navigation">
          {NAV_LINKS.map((link) => {
            const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
                  active
                    ? 'bg-[var(--accent)] text-white shadow-[0_1px_2px_rgba(0,0,0,0.08)]'
                    : 'text-[var(--text-muted)] hover:bg-[var(--landing-layer)] hover:text-[var(--text)]'
                }`}
              >
                <Icon>{link.icon}</Icon>
                <span>{link.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-[var(--border)] px-4 py-4">
          <div className="mb-3 rounded-lg border border-[var(--landing-soft-border)] bg-white px-3 py-2">
            <div className="truncate text-sm font-semibold text-[var(--text)]">{user?.name || 'Account'}</div>
            <div className="truncate text-xs text-[var(--text-muted)]">Signed in</div>
          </div>
          <Button variant="secondary" size="sm" className="w-full" onClick={() => logout()}>
            Log out
          </Button>
        </div>
      </aside>

      <div className="border-b border-[var(--border)] bg-[var(--landing-surface)] px-4 py-3 lg:hidden">
        <div className="flex items-center justify-between gap-3">
          <Link href="/websites" className="font-semibold text-[var(--text)]">AI Revenue Employee</Link>
          <Button variant="secondary" size="sm" onClick={() => logout()}>Log out</Button>
        </div>
        <nav className="mt-3 flex gap-2 overflow-x-auto pb-1" aria-label="Mobile product navigation">
          {NAV_LINKS.map((link) => {
            const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
            return (
              <Link key={link.href} href={link.href} className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold ${active ? 'border-[var(--accent)] bg-[var(--accent)] text-white' : 'border-[var(--landing-soft-border)] bg-white text-[var(--text-muted)]'}`}>
                {link.label}
              </Link>
            );
          })}
        </nav>
      </div>

      <main className="w-full px-4 py-6 sm:px-6 lg:ml-72 lg:w-[calc(100%-18rem)] lg:px-8 lg:py-8">
        <div className="mx-auto max-w-7xl">{children}</div>
      </main>
    </div>
  );
}


