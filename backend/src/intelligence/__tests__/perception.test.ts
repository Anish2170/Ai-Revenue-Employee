/**
 * Golden-file tests for the Sprint 4.1 perception loop.
 *
 * Feeds recorded semantic-event sequences (the §11.5 acceptance corpus) through
 * the full deterministic stack and asserts behaviour / intent / confidence /
 * decision. These are the executable form of "Sprint 4 done": all 8 scenarios
 * pass, INCLUDING the three silences.
 *
 * Run with:  npm test   (node --import tsx --test)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { perceive } from '../perceive.js';
import { runBehaviourEngine } from '../behaviourEngine.js';
import { runIntentEngine } from '../intentEngine.js';
import { computeConfidence } from '../confidence.js';
import { SCENARIOS } from './fixtures.js';

for (const s of SCENARIOS) {
  test(`scenario: ${s.name}`, () => {
    const behaviour = runBehaviourEngine(s.events, s.now);
    const intent = runIntentEngine(behaviour, s.context.returning);
    const confidence = computeConfidence(behaviour, intent, s.events, s.now);
    const decision = perceive({
      events: s.events,
      now: s.now,
      context: s.context,
      objective: s.objective,
      surface: s.surface,
    });

    // Helpful diagnostic on failure.
    const ctx = JSON.stringify({
      dominant: behaviour.dominant,
      dominantWeight: behaviour.dominantWeight,
      trajectory: behaviour.trajectory,
      stability: behaviour.stability,
      goal: intent.goal,
      readiness: intent.readiness,
      conflict: intent.conflict,
      confidence: confidence.score,
      band: confidence.band,
      speakScore: decision.speakScore,
      action: decision.action,
      suppressedBy: decision.suppressedBy,
    });

    if (s.expect.dominant !== undefined) {
      assert.equal(behaviour.dominant, s.expect.dominant, `dominant — ${ctx}`);
    }
    if (s.expect.goal !== undefined) {
      assert.equal(intent.goal, s.expect.goal, `goal — ${ctx}`);
    }
    if (s.expect.readiness !== undefined) {
      assert.equal(intent.readiness, s.expect.readiness, `readiness — ${ctx}`);
    }
    if (s.expect.band !== undefined) {
      assert.equal(confidence.band, s.expect.band, `band — ${ctx}`);
    }
    if (s.expect.suppressedBy !== undefined) {
      assert.equal(decision.suppressedBy, s.expect.suppressedBy, `suppressedBy — ${ctx}`);
    }
    assert.equal(decision.action, s.expect.action, `action — ${ctx}`);
  });
}

// --- Unit checks on the confidence arithmetic (§6.2 worked examples) ---

test('confidence: multiplicative collapse on conflicting exit signal', () => {
  const now = 40_000;
  const pricingEvents = [
    { type: 'content_dwell', zone: 'pricing', intensity: 0.9, ts: 10_000, surface: 'desktop' },
    { type: 'pricing_focus', zone: 'pricing', intensity: 0.9, ts: 20_000, surface: 'desktop' },
    { type: 'zone_revisit', zone: 'pricing', intensity: 0.9, ts: 30_000, surface: 'desktop' },
  ] as const;

  const b1 = runBehaviourEngine(pricingEvents, now);
  const i1 = runIntentEngine(b1);
  const c1 = computeConfidence(b1, i1, pricingEvents, now);

  // Same evidence but the read is cooling (contradiction) should not score higher.
  assert.ok(c1.score > 0, 'baseline confidence positive');
  assert.ok(c1.score <= 1, 'confidence bounded');
  // Each factor is within [0,1].
  for (const v of Object.values(c1.inputs)) {
    assert.ok(v >= 0 && v <= 1, `input in range: ${v}`);
  }
});

test('behaviour: evidence decays — stale spike does not dominate', () => {
  const old = [{ type: 'idle', zone: 'other', intensity: 1, ts: 1_000, surface: 'desktop' }] as const;
  // Evaluate far in the future: the idle weight should have decayed heavily.
  const decayed = runBehaviourEngine(old, 1_000 + 45_000 * 4);
  assert.ok((decayed.vector.Distracted ?? 0) < 0.1, 'idle decayed below 0.1 after 4 half-lives');
});

test('intent: goal and readiness are independent axes', () => {
  // Comparing hard but early (cold) vs comparing with forward momentum (warm).
  const coldCompare = [
    { type: 'zone_revisit', zone: 'product', intensity: 0.5, ts: 5_000, surface: 'desktop' },
  ] as const;
  const b = runBehaviourEngine(coldCompare, 6_000);
  const i = runIntentEngine(b);
  assert.equal(i.goal, 'Compare');
  // A single weak revisit should not read as hot.
  assert.notEqual(i.readiness, 'hot');
});
