'use client';

import { useEffect, useState } from 'react';
import { describeBuildProgress, BUILD_STEPS, type BuildProgressState } from '@/lib/knowledge-progress';

export function KnowledgeBuildProgress({ build, connectionLost = false }: { build: BuildProgressState; connectionLost?: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  const active = ['QUEUED', 'RUNNING', 'RETRY_WAIT'].includes(build.status);
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  const view = describeBuildProgress(build);
  const start = Date.parse(build.createdAt || build.startedAt || '');
  const end = build.finishedAt ? Date.parse(build.finishedAt) : now;
  const seconds = Number.isFinite(start) ? Math.max(0, Math.floor((end - start) / 1000)) : null;

  return (
    <div className="mt-6 rounded-xl border border-[var(--border)] bg-[var(--bg)] p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-semibold">{view.title}</h3>
          <p role="status" className="mt-1 text-sm text-[var(--text-muted)]">{view.description}</p>
        </div>
        <span className="text-2xl font-semibold tabular-nums text-[var(--accent)]">{view.percent}%</span>
      </div>
      <div role="progressbar" aria-label="Knowledge build progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={view.percent} aria-valuetext={`${view.percent}% estimated. ${view.description}`}
        className="mt-4 h-3 overflow-hidden rounded-full bg-[var(--border)]">
        <div className={`h-full rounded-full transition-[width] duration-500 motion-reduce:transition-none ${active ? 'motion-safe:animate-pulse' : ''} ${build.status === 'FAILED' ? 'bg-[var(--danger)]' : 'bg-[var(--accent)]'}`} style={{ width: `${view.percent}%` }} />
      </div>
      <div className="mt-2 flex flex-wrap justify-between gap-2 text-xs text-[var(--text-muted)]">
        <span>{active ? 'Estimated overall progress · updates as work completes' : view.title}</span>
        {seconds !== null && <span className="tabular-nums">{Math.floor(seconds / 60)}m {seconds % 60}s {active ? 'elapsed' : 'total'}</span>}
      </div>
      <ol aria-label="Build stages" className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {BUILD_STEPS.map((step, index) => {
          const done = build.status === 'SUCCESS' || index < view.step;
          const current = index === view.step && active && build.status !== 'RETRY_WAIT';
          return <li key={step.phase} aria-current={current ? 'step' : undefined} className={`flex items-center gap-2 text-xs ${done || current ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'}`}>
            <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${current ? 'border-[var(--accent)] font-bold' : 'border-[var(--border)]'}`}>{done ? '✓' : index + 1}</span>
            {step.label}
          </li>;
        })}
      </ol>
      {connectionLost && <p className="mt-4 text-sm text-[var(--warning)]">Connection interrupted. Showing the last confirmed progress; the build may still be running.</p>}
    </div>
  );
}
