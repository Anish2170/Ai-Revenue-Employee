'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';

export default function AuthLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const { loading, user } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && user) {
      api.listWebsites()
        .then((websites) => router.replace((websites as unknown[]).length === 0 ? '/onboarding' : '/analytics'))
        .catch(() => router.replace('/onboarding'));
    }
  }, [loading, router, user]);

  if (user) {
    return (
      <main className="auth-shell">
        <section className="auth-card" aria-live="polite">
          <p className="auth-subtitle">Loading...</p>
        </section>
      </main>
    );
  }

  return children;
}
