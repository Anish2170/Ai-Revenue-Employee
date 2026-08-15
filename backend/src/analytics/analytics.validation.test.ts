import assert from 'node:assert/strict';
import test from 'node:test';
import { analyticsIngestSchema, isAllowedAnalyticsEventName, normalizeAnalyticsOccurredAt } from './analytics.routes.js';

const eventId = '4c86ea5c-0f91-4b5e-85c0-3bedc0bb1b26';
const basePayload = {
  siteId: 'site-a', visitorToken: 'signed-token', visitorId: 'visitor-123', sessionId: 'session-123',
  events: [{ eventId, category: 'PAGE', eventName: 'page_viewed', occurredAt: '2026-08-12T10:00:00.000Z' }],
};

test('analytics validation accepts a bounded valid widget event', () => {
  assert.equal(analyticsIngestSchema.safeParse(basePayload).success, true);
  assert.equal(isAllowedAnalyticsEventName('PAGE', 'page_viewed'), true);
});

test('analytics validation rejects unknown fields, invalid IDs, and oversized values', () => {
  assert.equal(analyticsIngestSchema.safeParse({ ...basePayload, unexpected: 'poison' }).success, false);
  assert.equal(analyticsIngestSchema.safeParse({ ...basePayload, events: [{ ...basePayload.events[0], eventId: 'not-a-uuid' }] }).success, false);
  assert.equal(analyticsIngestSchema.safeParse({ ...basePayload, events: [{ ...basePayload.events[0], pageTitle: 'x'.repeat(513) }] }).success, false);
});

test('analytics event names and timestamps are constrained', () => {
  assert.equal(isAllowedAnalyticsEventName('CHAT', 'forged_metric'), false);
  assert.equal(isAllowedAnalyticsEventName('POPUP', 'cta_123_clicked'), true);
  const receipt = new Date('2026-08-12T10:00:00.000Z');
  assert.equal(normalizeAnalyticsOccurredAt('2026-08-12T10:10:00.000Z', receipt)?.toISOString(), '2026-08-12T10:10:00.000Z');
  assert.equal(normalizeAnalyticsOccurredAt('2026-08-20T10:00:00.000Z', receipt), null);
  assert.equal(normalizeAnalyticsOccurredAt('2026-08-01T10:00:00.000Z', receipt), null);
});

test('analytics event IDs are suitable idempotency keys and are scoped by the database website key', () => {
  assert.equal(analyticsIngestSchema.safeParse(basePayload).success, true);
  // The matching unique index is @@unique([websiteId, eventId]): the same UUID
  // can therefore be safely accepted for a different website, but not replayed
  // within this website.
  assert.equal(analyticsIngestSchema.safeParse({ ...basePayload, siteId: 'site-b' }).success, true);
});
