/** Synthetic fixtures only. Refuses every database except the isolated local
 * knowledge_sources_test cluster. No paid AI or external crawl requests. */
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createRequire } from 'node:module';
import express from 'express';
import cookieParser from 'cookie-parser';
const database = new URL(process.env.DATABASE_URL ?? 'postgresql://knowledge_test@127.0.0.1:55455/knowledge_sources_test');
assert.equal(database.hostname, '127.0.0.1'); assert.equal(database.port, '55455'); assert.equal(database.pathname, '/knowledge_sources_test');
process.env.DATABASE_URL = database.toString();
process.env.GEMINI_API_KEY = ''; process.env.OPENAI_API_KEY = ''; process.env.KNOWLEDGE_STORAGE = 'local';
process.env.SESSION_SECRET = 'synthetic-local-knowledge-source-verification-only';
process.env.KNOWLEDGE_DIR = resolve('../.tmp/knowledge-sources-20261105/artifacts');
process.env.FRONTEND_URL = 'http://127.0.0.1:4347'; process.env.DASHBOARD_ORIGIN = process.env.FRONTEND_URL; process.env.CORS_ORIGIN = process.env.FRONTEND_URL;
const { prisma } = await import('../src/db/prisma.js');
const { config } = await import('../src/config/index.js');
const { knowledgeSourcesRouter } = await import('../src/knowledge/sources.routes.js');
const { csrfTokenForSession } = await import('../src/auth/auth.middleware.js');
const services = await import('../src/knowledge/sources.service.js');
const { processOneSource, scheduleSources } = await import('../src/knowledge/sources.worker.js');
const { getWebsiteStore, invalidateWebsiteStore } = await import('../src/vectorstore/registry.js');
const { writeSnapshotArtifact } = await import('../src/vectorstore/snapshotStorage.js');
const { websiteSnapshotPath } = await import('../src/vectorstore/persistence.js');
const { crawl } = await import('../src/crawler/crawler.js');
const { buildSourceVersion } = await import('../src/knowledge/sources.worker.js');
import type { KnowledgeSnapshot, EmbeddedChunk } from '../src/context/types.js';
const serve = process.argv.includes('--serve');
const origin = 'https://knowledge-fixture.invalid';
const evidence = resolve('../.tmp/knowledge-sources-20261105'); await mkdir(evidence, { recursive: true });
const verified: string[] = [];
const mark = (name: string) => { verified.push(name); console.log(`PASS ${name}`); };
const org = await prisma.organization.create({ data: { name: 'Knowledge review fixture', slug: `knowledge-${randomUUID()}` } });
const foreign = await prisma.organization.create({ data: { name: 'Foreign fixture', slug: `foreign-${randomUUID()}` } });
const user = await prisma.user.create({ data: { name: 'Synthetic Owner', email: `${randomUUID()}@fixture.invalid` } });
await prisma.organizationMember.create({ data: { organizationId: org.id, userId: user.id, role: 'OWNER' } });
await prisma.organizationMember.create({ data: { organizationId: foreign.id, userId: user.id, role: 'OWNER' } });
const site = await prisma.website.create({ data: { organizationId: org.id, name: 'NovaCare Demo', url: origin } });
const otherSite = await prisma.website.create({ data: { organizationId: foreign.id, name: 'Other business', url: origin } });
const token = randomUUID(), foreignToken = randomUUID();
for (const [raw, organizationId] of [[token, org.id], [foreignToken, foreign.id]]) await prisma.session.create({ data: {
  userId: user.id, organizationId, tokenHash: createHash('sha256').update(raw).digest('hex'), expiresAt: new Date(Date.now() + 3600000),
} });
const snapshotId = randomUUID(), now = new Date(Date.now() - 60000).toISOString();
function document(path: string, heading: string, content: string): EmbeddedChunk {
  return { id: path, page: path, url: origin + path, title: heading, heading, pageType: path === '/pricing' ? 'pricing' : 'contact',
    section: heading, language: 'English', content, embedding: [1, 0], hash: services.contentHash(content), lastCrawled: now };
}
const docs = [document('/pricing', 'Dental cleaning', 'Dental cleaning starts at $999.'), document('/contact', 'Opening hours', 'The clinic opens Monday to Saturday, 9 AM to 7 PM.')];
const snapshot: KnowledgeSnapshot = { version: 1, embeddingModel: config.gemini.embeddingModel, dimensions: 2, sourceUrl: origin,
  createdAt: now, pages: docs.map(doc => ({ url: doc.url, path: doc.page, pageType: doc.pageType, contentHash: doc.hash, lastCrawled: now })),
  documents: docs, siteLinks: [], publication: { id: snapshotId, completedAt: now, completeness: 'complete', changed: 2, unchanged: 0, removed: 0, embeddingsReused: 0 } };
const artifact = await writeSnapshotArtifact({ websiteId: site.id, organizationId: org.id, snapshotId, snapshot,
  localKey: join(websiteSnapshotPath(site.id) + '.versions', snapshotId + '.json') });
await prisma.knowledgeSnapshot.create({ data: { id: snapshotId, websiteId: site.id, organizationId: org.id, sourceUrl: origin, status: 'READY',
  embeddingModel: config.gemini.embeddingModel, dimensions: 2, pagesCrawled: 2, chunkCount: 2, storageProvider: artifact.provider, storageKey: artifact.storageKey,
  contentSha256: artifact.contentSha256, contentBytes: artifact.contentBytes } });
const deps = { embed: async (chunks: import('../src/context/types.js').Chunk[]) => chunks.map(chunk => ({ ...chunk, embedding: [1, 0] })),
  crawl: (url: string, options: import('../src/crawler/crawler.js').CrawlOptions = {}) => crawl(url, options, { sleep: async () => {}, fetch: async target => {
    const path = new URL(target).pathname;
    return { url: target, status: path === '/robots.txt' ? 404 : path === '/broken' ? 503 : 200, headers: { 'content-type': 'text/html' },
      body: Buffer.from(`<main><h1>Dental cleaning</h1><p>Dental cleaning starts at $1999.</p><a href="/contact">Contact</a></main>`) };
  } }) };
function pdf(text: string) {
  const escaped = text.replace(/[\\()]/g, '\\$&');
  const stream = `BT /F1 12 Tf 50 750 Td (${escaped}) Tj ET`;
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`];
  let output = '%PDF-1.4\n'; const offsets = [0];
  objects.forEach((value, index) => { offsets.push(Buffer.byteLength(output)); output += `${index + 1} 0 obj\n${value}\nendobj\n`; });
  const start = Buffer.byteLength(output); output += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(value => String(value).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return Buffer.from(output);
}
const app = express(); app.use(express.json({ limit: '7mb' })); app.use(cookieParser());
app.get('/auth/csrf', (_req, res) => res.json({ csrfToken: csrfTokenForSession(token) }));
app.use((req, res, next) => req.path.startsWith('/api/') ? knowledgeSourcesRouter(req, res, next) : next());
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => { console.error(error); res.status(500).json({ message: 'Synthetic fixture request failed.' }); });
const server = await new Promise<ReturnType<typeof app.listen>>(resolveServer => { const listener = app.listen(serve ? 4347 : 0, '127.0.0.1', () => resolveServer(listener)); });
const base = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`;
const path = `/api/websites/${site.id}/knowledge`;
const headers = (raw = token, csrf = true) => ({ 'Content-Type': 'application/json', Cookie: `aire_session=${raw}`, Origin: 'http://127.0.0.1:4347', ...(csrf ? { 'X-CSRF-Token': csrfTokenForSession(raw) } : {}) });
async function request(endpoint: string, method = 'GET', body?: unknown) {
  const response = await fetch(base + path + endpoint, { method, headers: headers(), ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const result = await response.json(); assert.ok(response.ok, JSON.stringify(result)); return result as any;
}
async function cleanup() {
  await new Promise<void>(r => server.close(() => r()));
  await prisma.organization.deleteMany({ where: { id: { in: [org.id, foreign.id] } } }); await prisma.user.delete({ where: { id: user.id } }); await prisma.$disconnect();
}
try {
  assert.equal((await fetch(base + path + '/sources')).status, 401);
  assert.equal((await fetch(base + path + '/sources', { headers: headers(foreignToken) })).status, 404);
  assert.equal((await fetch(base + path + '/sources/text', { method: 'POST', headers: headers(token, false), body: JSON.stringify({ title: 'Note', content: 'Hidden content.' }) })).status, 403);
  mark('real HTTP authentication, CSRF and tenant isolation');
  await prisma.organizationMember.update({ where: { organizationId_userId: { organizationId: org.id, userId: user.id } }, data: { role: 'MEMBER' } });
  assert.equal((await fetch(base + path + '/sources/text', { method: 'POST', headers: headers(), body: JSON.stringify({ title: 'Note', content: 'Blocked.' }) })).status, 403);
  await prisma.organizationMember.update({ where: { organizationId_userId: { organizationId: org.id, userId: user.id } }, data: { role: 'OWNER' } });
  mark('member cannot modify sources');
  const note = await request('/sources/text', 'POST', { title: 'Current prices', content: 'Dental cleaning starts at $1499.' });
  await processOneSource(deps); const noteDetail = await request(`/sources/${note.id}`); assert.equal(noteDetail.status, 'READY'); assert.equal(noteDetail.chunks.length, 1);
  assert.equal((await getWebsiteStore(site.id)).store.size(), 3);
  mark('custom text queue, real SQL publication and composed retrieval');
  await request(`/sources/${note.id}`, 'PATCH', { priority: 50 });
  let inventory = await request('/sources'); assert.ok(inventory.conflicts.some((conflict: any) => conflict.resolvedByPriority));
  const answer = await request('/preview', 'POST', { question: 'What is the dental cleaning price?' });
  assert.match(answer.answer, /1,?499/); assert.doesNotMatch(answer.answer, /\$999/); assert.ok(answer.sources.some((source: any) => source.sourceId === note.id));
  mark('preferred-source price answer with inspectable sources');
  await request(`/sources/${note.id}`, 'PATCH', { enabled: false });
  assert.equal((await getWebsiteStore(site.id)).store.size(), 2);
  await request(`/sources/${note.id}`, 'PATCH', { enabled: true });
  await request(`/sources/${note.id}`, 'DELETE'); assert.equal((await getWebsiteStore(site.id)).store.size(), 2);
  await request(`/sources/${note.id}`, 'PATCH', { restore: true }); assert.equal((await getWebsiteStore(site.id)).store.size(), 3);
  mark('enable, disable, remove and restore affect AI retrieval');
  const bytes = pdf('Dental cleaning starts at $2499.'); await writeFile(join(evidence, 'synthetic-pricing.pdf'), bytes);
  const uploaded = await request('/sources/upload', 'POST', { name: 'Pricing.pdf', data: bytes.toString('base64') }); await processOneSource(deps);
  const detail = await request(`/sources/${uploaded.id}`); assert.equal(detail.status, 'READY'); assert.match(detail.content, /2499/);
  const repeated = await request('/sources/upload', 'POST', { name: 'Pricing.pdf', data: bytes.toString('base64') }); assert.equal(repeated.id, uploaded.id); await processOneSource(deps);
  mark('actual PDF extraction and duplicate upload identity');
  await request(`/sources/${uploaded.id}`, 'PATCH', { enabled: false });
  const badPdf = await request('/sources/upload', 'POST', { name: 'Empty.pdf', data: pdf('').toString('base64') }); await processOneSource(deps);
  assert.equal((await request(`/sources/${badPdf.id}`)).status, 'FAILED');
  mark('non-searchable PDF fails visibly instead of becoming ready');
  const page = await request('/sources/page', 'POST', { url: `${origin}/pricing?utm_source=test#pricing` }); await processOneSource(deps);
  let active = await getWebsiteStore(site.id); assert.equal(active.store.export().filter(chunk => chunk.url === origin + '/pricing').length, 1);
  assert.match(active.store.export().find(chunk => chunk.url === origin + '/pricing')!.content, /1999/);
  mark('single-page update replaces old content without duplicates');
  await request(`/sources/${page.id}/refresh`, 'POST');
  await processOneSource({ ...deps, crawl: async () => { throw Error('Synthetic page outage'); } });
  assert.equal((await request(`/sources/${page.id}`)).status, 'FAILED');
  assert.match((await getWebsiteStore(site.id)).store.export().find(chunk => chunk.url === origin + '/pricing')!.content, /1999/);
  mark('failed refresh retains last published content');
  await request(`/sources/${note.id}`, 'PATCH', { content: 'Dental cleaning starts at $3499.' });
  let release!: () => void, started!: () => void;
  const waiting = new Promise<void>(r => { started = r; }); const gate = new Promise<void>(r => { release = r; });
  const stale = processOneSource({ ...deps, embed: async chunks => { started(); await gate; return deps.embed(chunks); } });
  await waiting; await request(`/sources/${note.id}`, 'PATCH', { content: 'Dental cleaning starts at $4499.' }); release(); await stale;
  assert.equal((await request(`/sources/${note.id}`)).status, 'QUEUED'); await processOneSource(deps);
  assert.match((await request(`/sources/${note.id}`)).content, /4499/);
  mark('concurrent edit fences stale worker publication');
  await request(`/sources/${note.id}`, 'PATCH', { content: 'Dental cleaning starts at $5499.' });
  let unlockEmbedding!: () => void, embeddingStarted!: () => void;
  const embeddingWait = new Promise<void>(r => { embeddingStarted = r; });
  const embeddingGate = new Promise<void>(r => { unlockEmbedding = r; });
  const expiringWorker = processOneSource({ ...deps, embed: async chunks => { embeddingStarted(); await embeddingGate; return deps.embed(chunks); } });
  await embeddingWait;
  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "KnowledgeSource" WHERE "id" = ${note.id}::uuid FOR UPDATE`;
    await tx.knowledgeSource.update({ where: { id: note.id }, data: { leaseExpiresAt: new Date(Date.now() + 60) } });
    unlockEmbedding(); await new Promise(r => setTimeout(r, 160));
  });
  await expiringWorker;
  assert.match((await request(`/sources/${note.id}`)).content, /4499/);
  await processOneSource(deps); assert.match((await request(`/sources/${note.id}`)).content, /5499/);
  mark('lease expiry during a source row-lock wait rejects stale publication and permits recovery');
  await request(`/sources/${page.id}`, 'DELETE'); invalidateWebsiteStore(site.id);
  assert.equal((await getWebsiteStore(site.id)).store.export().filter(chunk => chunk.url === origin + '/pricing').length, 0);
  assert.ok((await getWebsiteStore(site.id)).store.export().some(chunk => chunk.knowledgeSourceId === note.id));
  mark('source removal survives cold load; custom data remains independent of snapshots');
  await request('/source-settings', 'PATCH', { refreshHours: 24 }); await scheduleSources();
  const contact = await prisma.knowledgeSource.findFirstOrThrow({ where: { websiteId: site.id, url: origin + '/contact' } }); assert.equal(contact.status, 'QUEUED');
  assert.equal((await prisma.knowledgeSource.findUniqueOrThrow({ where: { id: page.id } })).status, 'READY');
  await processOneSource(deps); await request('/source-settings', 'PATCH', { refreshHours: 0 });
  mark('daily scheduler queues enabled pages and preserves removed-source exclusions');
  assert.equal(await prisma.knowledgeSource.count({ where: { websiteId: otherSite.id } }), 0);
  mark('all changes stay inside the owned website');
  await writeFile(join(evidence, 'verification.json'), JSON.stringify({ verified, database: '127.0.0.1:55455/knowledge_sources_test', realPdfParser: true, realLLM: false, realExternalCrawl: false, migrationApplied: true }, null, 2));
  if (serve) {
    // Restore an inviting synthetic review state for visual checks.
    await request(`/sources/${page.id}`, 'PATCH', { restore: true });
    const { build } = createRequire(resolve('../widget/package.json'))('esbuild');
    const dashboard = resolve('../dashboard');
    const bundle = await build({ stdin: { loader: 'tsx', resolveDir: dashboard, contents: `import React from 'react';import{createRoot}from'react-dom/client';import{KnowledgeSources}from'./src/components/knowledge-sources.tsx';createRoot(document.getElementById('root')).render(<main style={{maxWidth:1160,margin:'0 auto',padding:24}}><h1 style={{fontSize:28,fontWeight:700,marginBottom:24}}>Knowledge base</h1><KnowledgeSources websiteId="${site.id}"/></main>);` },
      bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic', tsconfig: join(dashboard, 'tsconfig.json'),
      define: { 'process.env.NODE_ENV': '"development"', 'process.env.NEXT_PUBLIC_API_URL': 'window.location.origin' } });
    let css = '';
    for (const name of await readdir(join(dashboard, '.next/static/chunks'))) if (name.endsWith('.css')) css += await readFile(join(dashboard, '.next/static/chunks', name), 'utf8');
    app.get('/fixture.js', (_req, res) => res.type('js').send(bundle.outputFiles[0].text));
    app.get('/fixture.css', (_req, res) => res.type('css').send(css));
    app.get('/', (_req, res) => { res.cookie('aire_session', token, { httpOnly: true, sameSite: 'lax' }); res.type('html').send('<!doctype html><html><head><title>Knowledge source review — local verification</title><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body style="background:#f7f8f6"><div id="root"></div><script src="/fixture.js"></script></body></html>'); });
    let working = false;
    const worker = setInterval(() => { if (!working) { working = true; void processOneSource(deps).finally(() => { working = false; }); } }, 750);
    console.log(`Knowledge source review fixture ${base}`);
    const stop = async () => { clearInterval(worker); while (working) await new Promise(r => setTimeout(r, 50)); await cleanup(); process.exit(0); };
    process.on('SIGINT', () => { void stop(); }); process.on('SIGTERM', () => { void stop(); });
  } else { await cleanup(); console.log(`${verified.length} real PostgreSQL/HTTP scenarios passed.`); }
} catch (error) { console.error(error); await cleanup(); process.exitCode = 1; }
