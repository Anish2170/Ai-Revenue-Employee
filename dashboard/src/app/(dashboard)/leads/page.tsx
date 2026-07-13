'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { Badge, Card, EmptyState, Spinner } from '@/components/ui';

type LeadRow = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  interest: string;
  intent: string;
  scorePercent: number;
  scoreLabel: 'LOW' | 'MEDIUM' | 'HIGH';
  reason: string;
  lastQuestion: string | null;
  pagesVisited: string[];
  suggestedNextAction: string;
  status: string;
  capturedAt: string;
  website: { id: string; name: string; url: string };
  conversation: { id: string; title: string };
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function scoreVariant(label: LeadRow['scoreLabel']): 'success' | 'warning' | 'neutral' {
  if (label === 'HIGH') return 'success';
  if (label === 'MEDIUM') return 'warning';
  return 'neutral';
}

export default function LeadsPage() {
  const [rows, setRows] = useState<LeadRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    api.listLeads()
      .then((data) => { if (alive) setRows(data as LeadRow[]); })
      .catch((err) => alive && setError(err instanceof Error ? err.message : 'Unable to load leads'))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, []);

  if (loading) {
    return <div className="flex h-80 items-center justify-center"><Spinner /></div>;
  }

  if (error) {
    return <EmptyState title="Could not load leads" description={error} />;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold" style={{ color: 'var(--text)' }}>Leads</h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>Validated contact captures from high-intent conversations.</p>
        </div>
        <Badge>{rows.length} total</Badge>
      </div>

      {rows.length === 0 ? (
        <EmptyState title="No leads yet" description="Qualified visitors will appear here after they share valid contact details." />
      ) : (
        <Card className="p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-[1280px] w-full text-left text-sm">
              <thead style={{ background: 'var(--bg-input)', color: 'var(--text-muted)' }}>
                <tr>
                  <Th>Name</Th>
                  <Th>Email</Th>
                  <Th>Phone</Th>
                  <Th>Interest</Th>
                  <Th>Lead Score</Th>
                  <Th>Intent</Th>
                  <Th>Conversation</Th>
                  <Th>Source Website</Th>
                  <Th>Captured At</Th>
                  <Th>Status</Th>
                  <Th>Suggested Follow-up</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((lead) => (
                  <tr key={lead.id} className="border-t align-top" style={{ borderColor: 'var(--border)' }}>
                    <Td>{lead.name || 'Unknown'}</Td>
                    <Td>{lead.email || '-'}</Td>
                    <Td>{lead.phone || '-'}</Td>
                    <Td>{lead.interest}</Td>
                    <Td><Badge variant={scoreVariant(lead.scoreLabel)}>{lead.scorePercent}% {lead.scoreLabel}</Badge></Td>
                    <Td>{lead.intent}</Td>
                    <Td>
                      <Link className="font-medium hover:underline" style={{ color: 'var(--accent)' }} href={`/conversations?conversationId=${lead.conversation.id}`}>
                        {lead.conversation.title}
                      </Link>
                      <div className="mt-1 max-w-[220px] truncate text-xs" style={{ color: 'var(--text-muted)' }}>{lead.lastQuestion || firstReason(lead.reason)}</div>
                    </Td>
                    <Td>
                      <div className="font-medium" style={{ color: 'var(--text)' }}>{lead.website.name}</div>
                      <div className="mt-1 max-w-[220px] truncate text-xs" style={{ color: 'var(--text-muted)' }}>{lead.website.url}</div>
                    </Td>
                    <Td>{formatDate(lead.capturedAt)}</Td>
                    <Td><Badge>{lead.status}</Badge></Td>
                    <Td>
                      <div className="max-w-[280px] leading-5" style={{ color: 'var(--text)' }}>{lead.suggestedNextAction}</div>
                      <ReasonList reason={lead.reason} />
                      {lead.pagesVisited?.length > 0 && <div className="mt-2 max-w-[280px] truncate text-xs" style={{ color: 'var(--text-muted)' }}>Pages: {lead.pagesVisited.join(', ')}</div>}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide">{children}</th>;
}

function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-4 py-4" style={{ color: 'var(--text)' }}>{children}</td>;
}
function leadReasons(reason: string): string[] {
  return reason
    .split(/\r?\n|,/)
    .map((item) => item.replace(/^-\s*/, '').trim())
    .filter(Boolean);
}

function firstReason(reason: string): string {
  return leadReasons(reason)[0] || reason;
}

function ReasonList({ reason }: { reason: string }) {
  const reasons = leadReasons(reason).slice(0, 5);
  if (reasons.length === 0) return null;
  return (
    <ul className="mt-2 space-y-1 text-xs" style={{ color: 'var(--text-muted)' }}>
      {reasons.map((item) => <li key={item}>- {item}</li>)}
    </ul>
  );
}
