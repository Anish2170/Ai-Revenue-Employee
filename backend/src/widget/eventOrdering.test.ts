import assert from 'node:assert/strict';
import test from 'node:test';
import { ingestEvents } from '../services/perceptionService.js';
import { sessionStore } from '../intelligence/session/visitorSession.js';

function fixture(name: string) {
  return { siteId: `phase1-${name}`, sessionId: `phase1-session-${name}`, returning: false, surface: 'desktop' as const };
}
function event(ts: number, type = 'content_dwell') {
  return { type, ts, zone: 'pricing', intensity: 0.9, surface: 'desktop' };
}

test('F03: delayed older batch cannot regress decision time or revive stale evidence', t => {
  const input = fixture('late');
  t.after(() => sessionStore.deleteSite(input.siteId));
  ingestEvents({ ...input, rawEvents: [event(80_000), event(90_000, 'pricing_focus'), event(100_000, 'zone_revisit')] });
  const late = ingestEvents({ ...input, rawEvents: [event(2_000)] });
  assert.equal(late.accepted, 0);
  assert.equal(late.shadowDecision, undefined);
  assert.deepEqual(sessionStore.get(input.sessionId)!.events.map(item => item.ts), [80_000, 90_000, 100_000]);
});

test('F03: duplicate batches do not multiply evidence or generate another decision', t => {
  const input = fixture('duplicates');
  t.after(() => sessionStore.deleteSite(input.siteId));
  const rawEvents = [event(10_000), event(20_000, 'pricing_focus')];
  ingestEvents({ ...input, rawEvents });
  const replay = ingestEvents({ ...input, rawEvents });
  assert.equal(replay.accepted, 0);
  assert.equal(replay.shadowDecision, undefined);
  assert.equal(sessionStore.get(input.sessionId)!.events.length, 2);
  assert.equal(ingestEvents({ ...input, rawEvents: [] }).shadowDecision, undefined);
});

test('F03: fast-forwarded client timestamps cannot bypass server wall-clock cooldown', t => {
  const input = fixture('cooldown');
  t.after(() => sessionStore.deleteSite(input.siteId));
  t.mock.method(Date, 'now', () => 1_800_000_000_000);
  ingestEvents({ ...input, rawEvents: [event(10_000), event(20_000, 'pricing_focus'), event(30_000, 'zone_revisit')] });
  sessionStore.recordInterruption(input.sessionId, 30_000);
  const jumped = ingestEvents({ ...input, rawEvents: [event(90_000, 'cta_proximity')] });
  assert.equal(jumped.shadowDecision?.action, 'silent');
  assert.equal(jumped.shadowDecision?.suppressedBy, 'cooldown');
});

test('F03: mixed late/fresh batches stay sorted and only fresh evidence is accepted', t => {
  const input = fixture('mixed');
  t.after(() => sessionStore.deleteSite(input.siteId));
  ingestEvents({ ...input, rawEvents: [event(10_000), event(20_000, 'pricing_focus')] });
  const next = ingestEvents({ ...input, rawEvents: [event(40_000, 'zone_revisit'), event(5_000), event(30_000, 'cta_proximity')] });
  assert.equal(next.accepted, 2);
  assert.equal(next.decisionTs, 40_000);
  assert.deepEqual(sessionStore.get(input.sessionId)!.events.map(item => item.ts), [10_000, 20_000, 30_000, 40_000]);
});

test('F03: event IDs distinguish legitimate same-millisecond signals and reject replay', t => {
  const input = fixture('ids');
  t.after(() => sessionStore.deleteSite(input.siteId));
  const one = { ...event(10_000), id: '00000000-0000-4000-8000-000000000001' };
  const two = { ...event(10_000), id: '00000000-0000-4000-8000-000000000002' };
  assert.equal(ingestEvents({ ...input, rawEvents: [one, one, two] }).accepted, 2);
  assert.equal(ingestEvents({ ...input, rawEvents: [{ ...one, ts: 20_000 }] }).accepted, 0);
  assert.equal(sessionStore.get(input.sessionId)!.events.length, 2);
});

test('F03: rejected late form-start does not authorize a subsequent form-stall', t => {
  const input = fixture('sequence');
  t.after(() => sessionStore.deleteSite(input.siteId));
  ingestEvents({ ...input, rawEvents: [event(50_000)] });
  const result = ingestEvents({ ...input, rawEvents: [event(10_000, 'form_start'), event(60_000, 'form_stall')] });
  assert.equal(result.accepted, 0);
  assert.ok(result.dropped.includes('form_stall_without_start'));
});

test('F03: server cooldown expires after 25 real seconds without changing the policy', t => {
  const input = fixture('wall-expiry');
  t.after(() => sessionStore.deleteSite(input.siteId));
  let wall = 1_800_000_000_000;
  t.mock.method(Date, 'now', () => wall);
  ingestEvents({ ...input, rawEvents: [event(10_000), event(20_000, 'pricing_focus'), event(30_000, 'zone_revisit')] });
  sessionStore.recordInterruption(input.sessionId, 30_000);
  wall += 24_999;
  assert.equal(ingestEvents({ ...input, rawEvents: [event(90_000, 'cta_proximity')] }).shadowDecision?.suppressedBy, 'cooldown');
  wall++;
  assert.notEqual(ingestEvents({ ...input, rawEvents: [event(91_000, 'cta_engage')] }).shadowDecision?.suppressedBy, 'cooldown');
});

test('F03: old-session event delivery cannot mutate the renewed session', t => {
  const input = fixture('renewed');
  t.after(() => sessionStore.deleteSite(input.siteId));
  ingestEvents({ ...input, rawEvents: [event(100_000)] });
  const fresh = { ...input, sessionId: `${input.sessionId}-new` };
  ingestEvents({ ...fresh, rawEvents: [event(1_000)] });
  ingestEvents({ ...input, rawEvents: [event(2_000)] });
  assert.deepEqual(sessionStore.get(fresh.sessionId)!.events.map(item => item.ts), [1_000]);
});

test('F03: invalid/future-range clocks stay rejected and history remains bounded', t => {
  const input = fixture('bounds');
  t.after(() => sessionStore.deleteSite(input.siteId));
  assert.equal(ingestEvents({ ...input, rawEvents: [event(-1), event(Infinity), event(6 * 60 * 60_000 + 1)] }).accepted, 0);
  for (let i = 0; i < 5; i++) {
    ingestEvents({ ...input, rawEvents: Array.from({ length: 50 }, (_, j) => event((i * 50 + j) ** 2 * 200 + 1)) });
  }
  assert.equal(sessionStore.get(input.sessionId)!.events.length, 200);
});
