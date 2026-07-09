'use client';

import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { Badge, Button, Card, EmptyState, Spinner } from '@/components/ui';

type ConversationRow = {
  id: string;
  visitorId: string | null;
  title: string;
  status: string;
  summary: string | null;
  totalMessages: number;
  messageCount?: number;
  memoryCount?: number;
  currentPage: string | null;
  device: string | null;
  startedAt: string;
  lastMessageAt: string;
};

type ConversationDetail = ConversationRow & {
  messages: Array<{ id: string; role: 'user' | 'assistant'; content: string; timestamp: string; source: { title: string; url: string } | null }>;
  memories: Array<{ id: string; kind: string; content: string; confidence: number | null }>;
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

export default function ConversationsPage() {
  const [rows, setRows] = useState<ConversationRow[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    api.listConversations()
      .then((data) => {
        if (!alive) return;
        const list = data as ConversationRow[];
        setRows(list);
        setSelectedId((current) => current || list[0]?.id || '');
      })
      .catch((err) => alive && setError(err instanceof Error ? err.message : 'Unable to load conversations'))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    let alive = true;
    setDetailLoading(true);
    api.getConversation(selectedId)
      .then((data) => { if (alive) setDetail(data as ConversationDetail); })
      .catch((err) => alive && setError(err instanceof Error ? err.message : 'Unable to load conversation'))
      .finally(() => alive && setDetailLoading(false));
    return () => { alive = false; };
  }, [selectedId]);

  const selected = useMemo(() => rows.find((row) => row.id === selectedId), [rows, selectedId]);

  if (loading) {
    return <div className="flex h-80 items-center justify-center"><Spinner /></div>;
  }

  if (error) {
    return <EmptyState title="Could not load conversations" description={error} />;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold" style={{ color: 'var(--text)' }}>Conversations</h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>Persistent visitor conversations, memory, and full message history.</p>
        </div>
        <Badge>{rows.length} total</Badge>
      </div>

      {rows.length === 0 ? (
        <EmptyState title="No conversations yet" description="Visitor conversations will appear here after widget chats are persisted." />
      ) : (
        <div className="grid grid-cols-[420px_minmax(0,1fr)] gap-6">
          <Card className="p-0 overflow-hidden">
            <div className="border-b px-4 py-3" style={{ borderColor: 'var(--border)' }}>
              <div className="text-sm font-medium" style={{ color: 'var(--text)' }}>Newest first</div>
            </div>
            <div className="max-h-[calc(100vh-190px)] overflow-y-auto">
              {rows.map((row) => (
                <button
                  key={row.id}
                  type="button"
                  onClick={() => setSelectedId(row.id)}
                  className="block w-full border-b px-4 py-3 text-left transition-colors"
                  style={{ borderColor: 'var(--border)', background: row.id === selectedId ? 'var(--bg-input)' : 'transparent' }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold" style={{ color: 'var(--text)' }}>{row.title}</div>
                      <div className="mt-1 truncate text-xs" style={{ color: 'var(--text-muted)' }}>Visitor {row.visitorId?.slice(0, 10) || 'unknown'}</div>
                    </div>
                    <Badge variant={row.status === 'OPEN' ? 'success' : 'neutral'}>{row.status}</Badge>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                    <span>{row.messageCount ?? row.totalMessages} messages</span>
                    <span>{row.device || 'unknown'}</span>
                    <span className="col-span-2 truncate">{row.currentPage || '/'}</span>
                    <span className="col-span-2">Last active {formatDate(row.lastMessageAt)}</span>
                  </div>
                </button>
              ))}
            </div>
          </Card>

          <Card className="min-h-[640px]">
            {detailLoading ? (
              <div className="flex h-80 items-center justify-center"><Spinner /></div>
            ) : !detail && selected ? (
              <EmptyState title="Conversation unavailable" />
            ) : detail ? (
              <div className="space-y-6">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-xl font-semibold" style={{ color: 'var(--text)' }}>{detail.title}</h2>
                    <div className="mt-2 flex flex-wrap gap-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                      <span>Started {formatDate(detail.startedAt)}</span>
                      <span>Last active {formatDate(detail.lastMessageAt)}</span>
                      <span>{detail.messageCount ?? detail.totalMessages} messages</span>
                    </div>
                  </div>
                  <Button variant="secondary" size="sm" onClick={() => setSelectedId(detail.id)}>Refresh</Button>
                </div>

                <div className="grid grid-cols-2 gap-4 text-sm">
                  <Info label="Visitor" value={detail.visitorId || 'Unknown'} />
                  <Info label="Status" value={detail.status} />
                  <Info label="Current Page" value={detail.currentPage || '/'} />
                  <Info label="Device" value={detail.device || 'Unknown'} />
                </div>

                <section>
                  <h3 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>AI Summary</h3>
                  <p className="mt-2 rounded-lg border p-3 text-sm leading-6" style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}>
                    {detail.summary || 'No summary yet. It will update automatically after enough conversation turns.'}
                  </p>
                </section>

                <section>
                  <h3 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Memory</h3>
                  <div className="mt-2 space-y-2">
                    {detail.memories.length === 0 ? <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No durable memory extracted yet.</p> : detail.memories.map((memory) => (
                      <div key={memory.id} className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: 'var(--border)' }}>
                        <span className="font-medium" style={{ color: 'var(--text)' }}>{memory.kind}: </span>
                        <span style={{ color: 'var(--text-muted)' }}>{memory.content}</span>
                      </div>
                    ))}
                  </div>
                </section>

                <section>
                  <h3 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Chat History</h3>
                  <div className="mt-3 space-y-3">
                    {detail.messages.map((message) => (
                      <div key={message.id} className="flex" style={{ justifyContent: message.role === 'user' ? 'flex-end' : 'flex-start' }}>
                        <div className="max-w-[78%] rounded-lg border px-3 py-2" style={{ borderColor: 'var(--border)', background: message.role === 'user' ? 'var(--accent)' : 'var(--bg-input)', color: message.role === 'user' ? '#fff' : 'var(--text)' }}>
                          <div className="mb-1 text-[11px] uppercase opacity-70">{message.role}</div>
                          <div className="whitespace-pre-wrap text-sm leading-6">{message.content}</div>
                          {message.source && <div className="mt-2 text-xs opacity-80">Source: {message.source.title}</div>}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              </div>
            ) : null}
          </Card>
        </div>
      )}
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border px-3 py-2" style={{ borderColor: 'var(--border)' }}>
      <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{label}</div>
      <div className="mt-1 truncate text-sm" style={{ color: 'var(--text)' }}>{value}</div>
    </div>
  );
}