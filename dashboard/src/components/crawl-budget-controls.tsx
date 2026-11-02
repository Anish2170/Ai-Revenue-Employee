'use client';

const profiles = [
  { value: '25:3', label: 'Standard — 25 pages / 3 renders' },
  { value: '50:5', label: 'Larger — 50 pages / 5 renders' },
  { value: '100:8', label: 'Extended — 100 pages / 8 renders' },
  { value: '50:0', label: 'Static HTML — 50 pages / no renders' },
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
            {profile !== 'auto' && !profiles.some(item => item.value === profile) && <option value={profile}>Saved — {profile.replace(':', ' pages / ')} renders</option>}
            {profiles.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </label>
        <p className="text-xs text-[var(--text-muted)]">Auto starts with 25 pages / 3 browser renders and expands to 50 / 5, then 100 / 8 only when needed, within the same crawl. A render opens a page in a browser when its content needs JavaScript.</p>
        <p className="text-xs text-[var(--text-muted)]">Safety limits per crawl attempt: 100 page attempts, 8 browser renders, 500 requests and 2 minutes. Text and embedding-work limits also apply. These bound processing work, not an exact currency amount. Larger crawls may increase processing time and AI costs.</p>
        <p className="text-xs text-[var(--text-muted)]">Manual limits include failed page attempts. Static HTML disables browser rendering. Failed required sources still block publication; existing published knowledge remains available. A reviewed limited scope uses its explicitly approved fixed budget.</p>
      </div>
    </details>
  </div>;
}
