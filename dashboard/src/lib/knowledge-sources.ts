export interface KnowledgeSourceItem {
  id: string | null; url: string | null; kind: string; title: string; status: string; reason: string | null;
  enabled: boolean; priority: number; publishedAt: string | null; checkedAt: string | null;
  chunkCount: number; characters: number; summary: string; topics: string[]; servingPrevious: boolean;
}
export interface KnowledgeInventory {
  items: KnowledgeSourceItem[];
  conflicts: Array<{ kind: string; subject: string; urls: string[]; resolvedByPriority: boolean }>;
  refreshHours: number;
  overview: { total: number; ready: number; chunks: number; topics: string[] };
}
export interface KnowledgeSourceDetail {
  id: string; kind: string; title: string; url: string | null; content: string; pendingContent: string | null;
  status: string; enabled: boolean; priority: number; error: string | null; publishedAt: string | null; checkedAt: string | null;
  chunks: Array<{ id: string; heading: string; content: string }>;
}
export interface KnowledgePreview {
  answer: string;
  sources: Array<{ id: string; sourceId: string | null; title: string; url: string | null; kind: string; content: string; score: number }>;
  diagnostics: { conflicts?: unknown[]; mode?: string } | null;
}
