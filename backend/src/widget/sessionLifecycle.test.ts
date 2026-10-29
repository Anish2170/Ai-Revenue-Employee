import assert from 'node:assert/strict';
import test from 'node:test';
import { issuePublicWidgetIdentity } from './publicIdentity.js';
import { ingestEvents } from '../services/perceptionService.js';
import { sessionStore } from '../intelligence/session/visitorSession.js';
import { cooldownRemainingMs } from '../intelligence/popupTrace.js';

const initialEvents = [
  { type: 'content_dwell', zone: 'pricing', intensity: 0.9, ts: 10_000, surface: 'desktop' },
  { type: 'pricing_focus', zone: 'pricing', intensity: 0.9, ts: 25_000, surface: 'desktop' },
  { type: 'zone_revisit', zone: 'pricing', intensity: 0.9, ts: 60_000, surface: 'desktop' },
];

test('fresh signed visits do not inherit another tab dismissal, budget or event history', t => {
  const siteId = 'test-f02-isolation';
  t.after(() => sessionStore.deleteSite(siteId));
  const a = issuePublicWidgetIdentity(siteId);
  ingestEvents({ siteId, sessionId: a.identity.sessionId, returning: false, surface: 'desktop', rawEvents: initialEvents });
  sessionStore.recordInterruption(a.identity.sessionId, 60_000);
  sessionStore.markDismissed(a.identity.sessionId);
  const b = issuePublicWidgetIdentity(siteId, a.token);
  ingestEvents({ siteId, sessionId: b.identity.sessionId, returning: true, surface: 'desktop', rawEvents: initialEvents.slice(0, 1) });
  const oldVisit = sessionStore.get(a.identity.sessionId)!;
  const newVisit = sessionStore.get(b.identity.sessionId)!;
  assert.equal(a.identity.visitorId, b.identity.visitorId);
  assert.equal(oldVisit.dismissed, true);
  assert.equal(oldVisit.priorInterruptions, 1);
  assert.equal(oldVisit.events.length, 3);
  assert.equal(newVisit.dismissed, false);
  assert.equal(newVisit.priorInterruptions, 0);
  assert.equal(newVisit.lastInterruptionTs, null);
  assert.equal(newVisit.events.length, 1);
  assert.equal(newVisit.returning, true);
});

test('same signed session preserves cooldown and sequence history across page navigation', t => {
  const siteId = 'test-f02-navigation';
  t.after(() => sessionStore.deleteSite(siteId));
  const { identity } = issuePublicWidgetIdentity(siteId);
  const input = { siteId, sessionId: identity.sessionId, returning: false, surface: 'desktop' as const };
  ingestEvents({ ...input, rawEvents: initialEvents });
  sessionStore.recordInterruption(identity.sessionId, 60_000);
  const nextPage = ingestEvents({ ...input, rawEvents: [{ type: 'content_dwell', zone: 'pricing', intensity: 0.9, ts: 70_000, surface: 'desktop' }] });
  assert.equal(nextPage.decisionTs, 70_000);
  assert.equal(nextPage.shadowDecision?.suppressedBy, 'cooldown');
  const visit = sessionStore.get(identity.sessionId)!;
  assert.equal(visit.events.length, 4);
  assert.equal(visit.priorInterruptions, 1);
  assert.equal(cooldownRemainingMs(visit.lastInterruptionTs, nextPage.decisionTs!, 25_000), 15_000);
});
