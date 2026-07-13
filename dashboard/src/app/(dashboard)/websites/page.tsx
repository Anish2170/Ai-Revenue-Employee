'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { Button, Card, Spinner, EmptyState } from '@/components/ui';

interface Website {
  id: string;
  name: string;
  url: string;
  industry?: string;
  createdAt: string;
}

export default function WebsitesPage() {
  const router = useRouter();
  const [websites, setWebsites] = useState<Website[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ name: '', url: '', industry: '', description: '' });

  useEffect(() => {
    api.listWebsites().then((data) => setWebsites(data as Website[])).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setError('');
    try {
      const website = (await api.createWebsite({
        name: form.name,
        url: form.url,
        ...(form.industry && { industry: form.industry }),
        ...(form.description && { description: form.description }),
      })) as Website;
      router.push(`/onboarding?websiteId=${website.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create website');
    } finally {
      setCreating(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner />
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold">Websites</h1>
          <p className="text-[var(--text-muted)] mt-1">Manage your websites and their AI assistants.</p>
        </div>
        <Button variant="primary" onClick={() => setShowCreate(true)}>
          + Add Website
        </Button>
      </div>

      {showCreate && (
        <Card className="mb-8">
          <h2 className="text-lg font-semibold mb-4">Add a new website</h2>
          {error && <p className="text-[var(--danger)] text-sm mb-4">{error}</p>}
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Website Name *</label>
                <input
                  className="w-full px-3 py-2 bg-[var(--bg-input)] border border-[var(--border)] rounded-lg text-[var(--text)] focus:outline-none focus:border-[var(--accent)]"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="My Website"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">URL *</label>
                <input
                  className="w-full px-3 py-2 bg-[var(--bg-input)] border border-[var(--border)] rounded-lg text-[var(--text)] focus:outline-none focus:border-[var(--accent)]"
                  value={form.url}
                  onChange={(e) => setForm({ ...form, url: e.target.value })}
                  placeholder="https://example.com"
                  type="url"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Industry</label>
                <input
                  className="w-full px-3 py-2 bg-[var(--bg-input)] border border-[var(--border)] rounded-lg text-[var(--text)] focus:outline-none focus:border-[var(--accent)]"
                  value={form.industry}
                  onChange={(e) => setForm({ ...form, industry: e.target.value })}
                  placeholder="e.g. SaaS, E-commerce"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Description</label>
                <input
                  className="w-full px-3 py-2 bg-[var(--bg-input)] border border-[var(--border)] rounded-lg text-[var(--text)] focus:outline-none focus:border-[var(--accent)]"
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="Brief description"
                />
              </div>
            </div>
            <div className="flex gap-3">
              <Button variant="primary" type="submit" loading={creating}>Create Website</Button>
              <Button variant="ghost" onClick={() => setShowCreate(false)}>Cancel</Button>
            </div>
          </form>
        </Card>
      )}

      {websites.length === 0 ? (
        <EmptyState
          title="No websites yet"
          description="Add your first website to start engaging visitors with AI."
        />
      ) : (
        <div className="grid gap-4">
          {websites.map((site) => (
            <Card
              key={site.id}
              className="cursor-pointer hover:border-[var(--accent)] transition-colors"
              onClick={() => router.push(`/websites/${site.id}`)}
            >
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold text-lg">{site.name}</h3>
                  <p className="text-[var(--text-muted)] text-sm mt-1">{site.url}</p>
                </div>
                <div className="text-right">
                  {site.industry && (
                    <span className="text-xs bg-[var(--bg-input)] px-2 py-1 rounded-full text-[var(--text-muted)]">
                      {site.industry}
                    </span>
                  )}
                  <p className="text-[var(--text-muted)] text-xs mt-2">
                    Added {new Date(site.createdAt).toLocaleDateString()}
                  </p>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}



