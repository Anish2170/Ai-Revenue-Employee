import assert from 'node:assert/strict';
import test from 'node:test';
for (const key of ['DATABASE_URL', 'OPENAI_API_KEY', 'GEMINI_API_KEY']) process.env[key] = '';
(globalThis as any).prisma = { website: { async findFirst() { return null; }, async findUnique() { return null; } }, widget: { async update() { throw Error('Unexpected write'); } } };
const { hasWidgetScript, buildScriptSnippet, inspectWidgetInstallation, verifyWidgetInstallation } = await import('./widget.service.js');
const { prisma } = await import('../db/prisma.js');

test('installation requires an actual script with matching site ID and backend source', () => {
  const siteId = 'site_fixture', url = 'https://fitness.example.test/';
  assert.equal(hasWidgetScript(buildScriptSnippet(siteId), url, siteId), true);
  assert.equal(hasWidgetScript(buildScriptSnippet('site_other'), url, siteId), false);
  assert.equal(hasWidgetScript(`<div data-site-id="${siteId}"></div>`, url, siteId), false);
  assert.equal(hasWidgetScript(`<!-- ${buildScriptSnippet(siteId)} -->`, url, siteId), false);
  assert.equal(hasWidgetScript(`<pre>${buildScriptSnippet(siteId).replaceAll('<', '&lt;')}</pre>`, url, siteId), false);
  assert.equal(hasWidgetScript(`<script src="https://other.example/widget.js" data-site-id="${siteId}"></script>`, url, siteId), false);
});

const url = 'https://fitness.example.test/', siteId = 'site_fixture';
const response = (html: string, status = 200) => async () => ({ url, status, headers: { 'content-type': 'text/html' }, body: Buffer.from(html) });
test('static installation uses the fast check without launching Chromium', async () => {
 const result = await inspectWidgetInstallation(url, siteId, { fetch: response(buildScriptSnippet(siteId)) });
 assert.equal(result.installed, true); assert.equal(result.verificationStatus, 'installed');
});
test('JavaScript-only installation is inconclusive when browser verification is unavailable', async () => {
 const result = await inspectWidgetInstallation(url, siteId, { fetch: response('<script src="/_next/app.js"></script>') });
 assert.equal(result.installed, false); assert.equal(result.verificationStatus, 'inconclusive');
 assert.match(result.reason, /cannot be verified while browser rendering is unavailable/);
});
test('inert Next payload or preload alone never verifies installation', async () => {
 const html = `<link rel="preload" href="/widget.js"><script type="application/json">${JSON.stringify({ src: '/widget.js', 'data-site-id': siteId })}</script>`;
 const result = await inspectWidgetInstallation(url, siteId, { fetch: response(html) });
 assert.equal(result.installed, false); assert.equal(result.verificationStatus, 'inconclusive');
});
test('plain HTML without an install tag is missing', async () => {
 const result = await inspectWidgetInstallation(url, siteId, { fetch: response('<main>Welcome to our gym.</main>') });
 assert.equal(result.installed, false); assert.equal(result.verificationStatus, 'missing');
});
test('HTTP failure is inconclusive', async () => {
 const result = await inspectWidgetInstallation(url, siteId, { fetch: response('', 503) });
 assert.equal(result.installed, false); assert.equal(result.verificationStatus, 'inconclusive');
});
test('inconclusive JavaScript verification preserves an existing installedAt timestamp', async t => {
 const installedAt = new Date('2026-11-01T00:00:00Z');
 const website = { id: 'fixture-site', organizationId: 'fixture-org', url, deletedAt: null,
  widget: { id: 'fixture-widget', siteId, installedAt } };
 t.mock.method(prisma.website, 'findFirst', async () => website as any);
 t.mock.method(prisma.website, 'findUnique', async () => website as any);
 const update = t.mock.method(prisma.widget, 'update', async () => { throw Error('must not update inconclusive status'); });
 // Exercise the HTTP transport without connecting to a public site or database.
 const result = await verifyWidgetInstallation('fixture-org', 'fixture-site', { fetch: response('<script src="/_next/app.js"></script>') });
 assert.ok('verificationStatus' in result);
 assert.equal(result.verificationStatus, 'inconclusive'); assert.equal(update.mock.callCount(), 0);
 assert.equal(website.widget.installedAt, installedAt);
});
