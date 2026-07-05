/**
 * Versioned snapshot persistence for the knowledge index.
 *
 * Supports both the legacy single-file path (dev-fallback tenant) and
 * per-website paths (`data/knowledge/<websiteId>.json`) for multi-tenant.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config/index.js';
import type { KnowledgeSnapshot } from '../context/types.js';

// backend/src/vectorstore (dev) or backend/dist/vectorstore (prod) → backend/
const backendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Legacy single-file path (Sprint 2 / dev-fallback). */
export function legacySnapshotPath(): string {
  return resolve(backendRoot, config.legacySnapshotPath);
}

/** Per-website snapshot path. */
export function websiteSnapshotPath(websiteId: string): string {
  return resolve(backendRoot, config.knowledgeDir, `${websiteId}.json`);
}

/** Persist a snapshot to any path, creating directories if needed. */
export async function saveSnapshotFile(path: string, snapshot: KnowledgeSnapshot): Promise<string> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(snapshot), 'utf8');
  return path;
}

/** Load a snapshot from any path, or null if missing/unreadable/corrupt. */
export async function loadSnapshotFile(path: string): Promise<KnowledgeSnapshot | null> {
  try {
    const raw = await readFile(path, 'utf8');
    return JSON.parse(raw) as KnowledgeSnapshot;
  } catch {
    return null;
  }
}

// --- Legacy API (used by vectorstore/index.ts dev-fallback singleton) ---

export function snapshotPath(): string {
  return legacySnapshotPath();
}

export async function saveSnapshot(snapshot: KnowledgeSnapshot): Promise<string> {
  return saveSnapshotFile(legacySnapshotPath(), snapshot);
}

export async function loadSnapshot(): Promise<KnowledgeSnapshot | null> {
  return loadSnapshotFile(legacySnapshotPath());
}
