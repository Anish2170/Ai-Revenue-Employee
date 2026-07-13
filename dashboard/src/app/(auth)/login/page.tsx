'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setSubmitting(true);

    try {
      await login(email, password);
      let destination = '/onboarding';
      try {
        const websites = (await api.listWebsites()) as unknown[];
        destination = websites.length === 0 ? '/onboarding' : '/dashboard';
      } catch {
        destination = '/onboarding';
      }
      router.replace(destination);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to log in');
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-card" aria-labelledby="login-title">
        <Link href="/" className="auth-brand" aria-label="AI Revenue Employee home"><span className="auth-logo-mark">AI</span><span>AI Revenue Employee</span></Link>
        <h1 id="login-title">Welcome back</h1>
        <p className="auth-subtitle">Log in to continue to your AI Revenue Employee workspace.</p>

        <form onSubmit={handleSubmit} className="auth-form">
          <div className="auth-field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </div>

          <div className="auth-field">
            <div className="auth-row">
              <label htmlFor="password">Password</label>
              <Link href="#" className="auth-forgot">Forgot Password</Link>
            </div>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
          </div>

          {error && <p className="auth-error">{error}</p>}

          <button className="auth-primary" type="submit" disabled={submitting}>
            {submitting ? 'Logging in...' : 'Login'}
          </button>
        </form>

        <p className="auth-footer">
          No account? <Link href="/signup">Create Account</Link>
        </p>
      </section>
    </main>
  );
}



