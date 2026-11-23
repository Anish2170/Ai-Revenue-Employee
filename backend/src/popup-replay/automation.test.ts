import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
process.env.DEBUG_TRACE = 'false';
for (const key of ['DATABASE_URL', 'OPENAI_API_KEY', 'GEMINI_API_KEY']) process.env[key] = '';
const { replayScope } = await import('./runtime.js');
const { ingestEvents } = await import('../services/perceptionService.js');

const opts = () => ({ siteId: 'qa-filter-test', sessionId: randomUUID(), returning: false, surface: 'desktop' as const, rawEvents: [{ type: 'content_dwell', zone: 'pricing', intensity: .9, ts: 3000, surface: 'desktop' }], botSignal: { webdriver: true, userAgent: 'HeadlessChrome' } });
test('ordinary webdriver sessions stay blocked; verified replay scope permits known QA automation', () => {
  assert.equal(ingestEvents(opts()).status, 'bot');
  const result = replayScope.run({ runId: randomUUID(), batchId: randomUUID(), siteId: 'qa-filter-test', runnerId: randomUUID() }, () => ingestEvents(opts()));
  assert.equal(result.status, 'ack'); assert.equal(result.accepted, 1);
});
test('QA automation still rejects machine-periodic event cadence', () => {
  const input = opts();
  input.rawEvents = Array.from({ length: 6 }, (_, index) => ({ type: 'content_dwell', zone: ['pricing','product','trust','faq','contact','other'][index], intensity: .9, ts: index * 1000, surface: 'desktop' }));
  const result = replayScope.run({ runId: randomUUID(), batchId: randomUUID(), siteId: 'qa-filter-test', runnerId: randomUUID() }, () => ingestEvents(input));
  assert.equal(result.status, 'bot'); assert.ok(result.dropped.includes('bot:periodic_cadence'));
});
