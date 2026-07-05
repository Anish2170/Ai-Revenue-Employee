/**
 * Tests for the ingest guards (§10.4 event quality, §10.5 bot filtering) and the
 * shadow-mode ingest service.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { validateEvents } from '../ingest/eventQuality.js';
import { classifyBot } from '../ingest/botFilter.js';
import { ingestEvents } from '../../services/perceptionService.js';

// --- Event quality (§10.4) ---

test('eventQuality: drops unknown type/zone and clamps intensity', () => {
  const { clean, dropped } = validateEvents([
    { type: 'content_dwell', zone: 'pricing', intensity: 5, ts: 1000, surface: 'desktop' },
    { type: 'nonsense', zone: 'pricing', intensity: 0.5, ts: 2000 },
    { type: 'pricing_focus', zone: 'atlantis', intensity: 0.5, ts: 3000 },
  ]);
  assert.equal(clean.length, 1);
  assert.equal(clean[0].intensity, 1, 'intensity clamped to 1');
  assert.ok(dropped.some((d) => d.startsWith('unknown_type')));
  assert.ok(dropped.some((d) => d.startsWith('unknown_zone')));
});

test('eventQuality: drops impossible sequences (stall before start)', () => {
  const { clean, dropped } = validateEvents([
    { type: 'form_stall', zone: 'contact', intensity: 0.8, ts: 1000, surface: 'desktop' },
  ]);
  assert.equal(clean.length, 0);
  assert.ok(dropped.includes('form_stall_without_start'));
});

test('eventQuality: accepts stall when start seen in a prior batch', () => {
  const { clean } = validateEvents(
    [{ type: 'form_stall', zone: 'contact', intensity: 0.8, ts: 5000, surface: 'desktop' }],
    new Set(['form_start']),
  );
  assert.equal(clean.length, 1);
});

// --- Bot filtering (§10.5) ---

test('botFilter: flags navigator.webdriver', () => {
  const v = classifyBot([], { webdriver: true });
  assert.equal(v.isBot, true);
  assert.equal(v.reason, 'webdriver');
});

test('botFilter: flags perfectly periodic cadence', () => {
  const events = Array.from({ length: 6 }, (_, i) => ({
    type: 'content_dwell' as const,
    zone: 'other' as const,
    intensity: 0.5,
    ts: i * 1000, // exactly periodic
    surface: 'desktop' as const,
  }));
  const v = classifyBot(events);
  assert.equal(v.isBot, true);
  assert.equal(v.reason, 'periodic_cadence');
});

test('botFilter: leaves human-like jitter alone', () => {
  const ts = [0, 900, 2100, 2600, 4400, 5000];
  const events = ts.map((t) => ({
    type: 'content_dwell' as const,
    zone: 'other' as const,
    intensity: 0.5,
    ts: t,
    surface: 'desktop' as const,
  }));
  const v = classifyBot(events);
  assert.equal(v.isBot, false);
});

// --- Shadow ingest service (end-to-end, no HTTP) ---

test('ingestEvents: shadow acks and never enacts; bot short-circuits', () => {
  const sessionId = 'test-session-aaaaaaaa';
  const ack = ingestEvents({
    siteId: null,
    sessionId,
    returning: false,
    surface: 'desktop',
    rawEvents: [
      { type: 'content_dwell', zone: 'pricing', intensity: 0.9, ts: 10_000, surface: 'desktop' },
      { type: 'pricing_focus', zone: 'pricing', intensity: 0.9, ts: 20_000, surface: 'desktop' },
      { type: 'zone_revisit', zone: 'pricing', intensity: 0.9, ts: 30_000, surface: 'desktop' },
    ],
  });
  assert.equal(ack.status, 'ack');
  assert.equal(ack.accepted, 3);
  assert.ok(ack.shadowDecision, 'shadow decision computed');
  // Shadow decision must be flagged shadow (never enacted in 4.1).
  assert.equal(ack.shadowDecision!.trace.shadow, true);

  // A webdriver batch on a NEW session is flagged as a bot.
  const bot = ingestEvents({
    siteId: null,
    sessionId: 'bot-session-bbbbbbbb',
    returning: false,
    surface: 'desktop',
    rawEvents: [{ type: 'content_dwell', zone: 'other', intensity: 0.5, ts: 1000, surface: 'desktop' }],
    botSignal: { webdriver: true },
  });
  assert.equal(bot.status, 'bot');
});
