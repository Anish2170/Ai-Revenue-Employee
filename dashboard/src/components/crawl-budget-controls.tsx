'use client';

const profiles = [
  { value: '25:3', label: 'Standard — 25 pages' },
  { value: '50:5', label: 'Larger — 50 pages' },
  { value: '100:8', label: 'Extended — 100 pages' },
  { value: '50:0', label: 'Static HTML — 50 pages' },
];

export function CrawlBudgetControls({ profile, disabled, onChange }: { profile: string; disabled?: boolean; onChange: (profile: string) => void }) {
  const automatic = profile === 'auto';
  return <div className="mb-4 space-y-3 text-sm">
    <div>
      <p className="font-medium">{automatic ? 'Auto crawl — recommended' : 'Manual crawl limits active'}</p>
      <p className="mt-1 text-[var(--text-muted)]">{automatic
        ? 'Automatically grows with your website, up to 100 pages. No budget selection needed.'
        : 'Your selected limits stay fixed. Select Auto below to let the crawl grow with your website.'}</p>
    </div>
    <details className="rounded-lg border border-[var(--border)] p-3">
      <summary className="cursor-pointer font-medium">Advanced crawl options{automatic ? '' : ' — manual override'}</summary>
      <div className="mt-3 space-y-3">
        <label className="block">Crawl budget
          <select aria-label="Crawl budget" className="ml-3 rounded border border-[var(--border)] bg-[var(--bg)] p-2" value={profile} disabled={disabled} onChange={event => onChange(event.target.value)}>
            <option value="auto">Auto — recommended</option>
            {profile !== 'auto' && !profiles.some(item => item.value === profile) && <option value={profile}>Saved — {profile.split(':')[0]} pages</option>}
            {profiles.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </label>
        <p className="text-xs text-[var(--text-muted)]">Auto starts with 25 page attempts and expands to 50, then 100 only when needed, within the same crawl.</p>
        <p className="text-xs text-[var(--text-muted)]">Pages are read from their HTML. Content that is available only after JavaScript runs cannot be read by the current crawler and will appear in crawl details for review.</p>
        <p className="text-xs text-[var(--text-muted)]">Safety limits per crawl attempt: 100 page attempts, 500 requests and 2 minutes. Text and embedding-work limits also apply. These bound processing work, not an exact currency amount. Larger crawls may increase processing time and AI costs.</p>
        <p className="text-xs text-[var(--text-muted)]">Manual limits include failed page attempts. Failed required sources still block publication; any existing published knowledge remains available. A reviewed limited scope uses its explicitly approved fixed budget.</p>
      </div>
    </details>
  </div>;
}
