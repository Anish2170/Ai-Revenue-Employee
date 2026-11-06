import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { failPopupGeneration } from '../popupGenerationFailure.js';
import { observePopupContext, reservePopup } from '../popupLifecycle.js';
import { sessionStore } from '../session/visitorSession.js';
import { LLMTimeoutError } from '../../llm/provider/errors.js';

function fixture(t: TestContext) {
  const siteId = `popup-failure-${t.name}`;
  const session = sessionStore.getOrCreate(siteId, { siteId, returning: false });
  t.after(() => sessionStore.deleteSite(siteId));
  const context = { pageInstanceId: 'page-a', pageStartedAt: 1000, version: 1, blockedReason: null };
  const candidate = reservePopup(session, context, 1000).candidate!;
  assert.ok(candidate);
  return { session, context, candidate };
}

for (const [name, error, expected] of [
  ['provider rate limit', Object.assign(new Error('Synthetic rate limit'), { status: 429 }), 'popup_generation_failed'],
  ['provider unavailable', Object.assign(new Error('Synthetic unavailable'), { status: 503 }), 'popup_generation_failed'],
  ['generation timeout', new LLMTimeoutError('Synthetic generation timed out'), 'popup_timeout'],
] as const) {
  test(`${name} retains its failure reason despite cleanup aborting generation`, t => {
    const { session, candidate } = fixture(t);
    assert.equal(candidate.controller.signal.aborted, false);
    assert.equal(failPopupGeneration(session, candidate, error), expected);
    assert.equal(candidate.controller.signal.aborted, true);
    assert.equal(candidate.status, 'failed');
    assert.equal(session.priorInterruptions, 0);
    assert.ok(session.popupLifecycle!.retryAt > Date.now());
  });
}

test('hidden-page cancellation keeps its original reason and released state', t => {
  const { session, context, candidate } = fixture(t);
  observePopupContext(session, { ...context, version: 2, blockedReason: 'hidden' });
  const originalAbort = candidate.controller.signal.reason;
  assert.equal(failPopupGeneration(session, candidate, new LLMTimeoutError('Late error')), 'popup_cancelled');
  assert.equal(candidate.status, 'released');
  assert.equal(candidate.controller.signal.reason, originalAbort);
  assert.equal(session.priorInterruptions, 0);
});

test('disconnected-widget cancellation remains cancelled and retains its original abort', t => {
  const { session, candidate } = fixture(t);
  const originalAbort = new Error('Widget request disconnected');
  candidate.controller.abort(originalAbort);
  assert.equal(failPopupGeneration(session, candidate, new Error('Late provider error')), 'popup_cancelled');
  assert.equal(candidate.controller.signal.reason, originalAbort);
  assert.equal(candidate.status, 'failed');
  assert.ok(session.popupLifecycle!.retryAt >= candidate.expiresAt);
});
