'use client';

import { useAuth } from '@/lib/auth-context';
import { Button, Card } from '@/components/ui';

export default function SettingsPage() {
  const { user, logout } = useAuth();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-[-0.01em] text-[var(--text)]">Settings</h1>
          <p className="mt-1 text-sm text-[var(--text-muted)]">Manage your workspace preferences and account session.</p>
        </div>
        <Button variant="secondary" onClick={() => logout()}>Log out</Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="text-lg font-semibold text-[var(--text)]">Account</h2>
          <p className="mt-1 text-sm text-[var(--text-muted)]">Your signed-in profile for this workspace.</p>
          <div className="mt-5 space-y-4">
            <Field label="Name" value={user?.name || 'Account user'} />
            <Field label="Session" value="Active" />
          </div>
        </Card>

        <Card>
          <h2 className="text-lg font-semibold text-[var(--text)]">Product Defaults</h2>
          <p className="mt-1 text-sm text-[var(--text-muted)]">Shared styling and behavior inherit the AI Revenue Employee defaults.</p>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <SettingPill label="Theme" value="Stitch Light" />
            <SettingPill label="Primary Action" value="Forest" />
            <SettingPill label="Typography" value="Inter" />
            <SettingPill label="Status" value="Configured" />
          </div>
        </Card>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <label className="block">
      <span className="text-xs font-semibold uppercase tracking-[0.05em] text-[var(--text)]">{label}</span>
      <input className="mt-1 min-h-11 w-full rounded-lg border border-[var(--landing-soft-border)] bg-white px-3 py-2.5 text-sm text-[var(--text)]" value={value} readOnly />
    </label>
  );
}

function SettingPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[var(--landing-soft-border)] bg-[var(--landing-layer-low)] p-3">
      <div className="text-xs font-semibold uppercase tracking-[0.05em] text-[var(--text-muted)]">{label}</div>
      <div className="mt-1 text-sm font-semibold text-[var(--text)]">{value}</div>
    </div>
  );
}
