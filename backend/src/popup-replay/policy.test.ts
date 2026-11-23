import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRunPlan, classifyReplayOutcome, reserveQuote, safeWebsiteUrl, REPLAY } from './policy.js';
import { issueReplayWidgetIdentity, issuePublicWidgetIdentity, verifyPublicWidgetIdentity } from '../widget/publicIdentity.js';

test('50 journeys are balanced without assigning a popup result or confidence', () => {
  const runs = buildRunPlan(['pricing', 'trust', 'comparison'], 50, 'desktop');
  assert.equal(runs.length, 50); assert.deepEqual(runs[0], { ordinal: 1, scenario: 'pricing', surface: 'desktop' });
  assert.equal(runs.filter(r => r.scenario === 'pricing').length, 17);
  for (const count of [0, -1, 51, 1.5]) assert.throws(() => buildRunPlan(['pricing'], count, 'desktop'));
  assert.throws(() => buildRunPlan([], 1, 'desktop'));
});
test('cost ceilings count full UTF-8 input plus bounded output and reject unknown models', () => {
  assert.equal(reserveQuote('generation', 'gpt-6-luna', 1000), 1000 + REPLAY.maxOutputTokens * 10);
  assert.equal(reserveQuote('embedding', 'gemini-embedding-001', 100), 100);
  for (const [kind, model, size] of [['generation', 'unknown-model', 100], ['embedding', 'gpt-6-luna', 100], ['generation', 'gpt-6-luna', 60001]] as const) assert.throws(() => reserveQuote(kind, model, size));
});
test('QA claims are signed, short-lived and fresh; ordinary visitor issuer is unchanged', () => {
  const a = issueReplayWidgetIdentity('site-a', 'run-a'), b = issueReplayWidgetIdentity('site-a', 'run-b');
  assert.notEqual(a.identity.visitorId, b.identity.visitorId); assert.notEqual(a.identity.sessionId, b.identity.sessionId);
  assert.equal(verifyPublicWidgetIdentity(a.token, 'site-a')?.replayRunId, 'run-a');
  assert.equal(verifyPublicWidgetIdentity(`${a.token}tampered`, 'site-a'), null);
  assert.equal(verifyPublicWidgetIdentity(a.token, 'site-b'), null);
  assert.ok(a.identity.exp - Date.now() <= REPLAY.leaseMs);
  assert.equal(issuePublicWidgetIdentity('site-a').identity.replayRunId, undefined);
});
test('job URLs exclude credentials, unsafe protocols, loopback and private literals', () => {
  assert.equal(safeWebsiteUrl('https://example.com/services').hostname, 'example.com');
  for (const url of ['http://example.com', 'file:///etc/passwd', 'https://user:password@example.com', 'https://127.0.0.1', 'https://2130706433', 'https://10.0.0.1', 'https://[::1]', 'https://metadata.local']) assert.throws(() => safeWebsiteUrl(url), url);
});
test('displayed claims require server receipts and matching copy; silence requires real evidence', () => {
  assert.equal(classifyReplayOutcome('pricing', 'displayed', true, false, true, true), 'DISPLAYED');
  assert.equal(classifyReplayOutcome('pricing', 'displayed', true, false, false, true), 'FAILED');
  assert.equal(classifyReplayOutcome('pricing', 'displayed', false, false, true, true), 'FAILED');
  assert.equal(classifyReplayOutcome('typing', 'silent', false, true, false, true), 'SUPPRESSED');
  assert.equal(classifyReplayOutcome('typing', 'silent', false, false, false, true), 'FAILED');
  assert.equal(classifyReplayOutcome('hidden', 'failed', true, true, true, true), 'UNEXPECTED_POPUP');
  assert.equal(classifyReplayOutcome('pricing', 'silent', false, false, false, false), 'FAILED');
});
