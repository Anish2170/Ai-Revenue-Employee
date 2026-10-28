import assert from 'node:assert/strict';
import test from 'node:test';
import {buildPopupCopyPlan,checkPopupGrounding} from '../popupGrounding.js';
import {resolvePopupAction} from '../popupActionPolicy.js';
import {validCopy,validActions,instructions,strategy} from './phase26Fixtures.js';
// English acceptance is preserved. Localized popup acceptance is deliberately
// superseded by the explicit English-only product policy; chat is independent.
for (const fixture of validCopy.filter(item => !item.id.startsWith('old-') && item.supported !== false)) {
  const english = fixture.language === 'English';
  test(`${english ? 'Phase26 useful English copy' : 'Reject formerly localized popup'}: ${fixture.id}`, () => {
    const plan = buildPopupCopyPlan(fixture.source, { ...instructions, language: fixture.language }, { pagePath: '/pricing' });
    assert.equal(checkPopupGrounding(fixture.title, fixture.body, plan).ok, english);
  });
}
for (const fixture of validActions.filter(item => item.supported !== false)) {
  const english = !['hindi-label', 'french-label'].includes(fixture.id);
  test(`${english ? 'Phase26 custom English CTA' : 'Reject formerly localized CTA'}: ${fixture.id}`, () => {
    assert.equal(Boolean(resolvePopupAction([fixture.action], fixture.action.actionId,
      strategy(fixture.kind, fixture.goal), { ...instructions, goal: fixture.goal }, false,
      'Want help choosing the next step?', { websiteId: 'tenant-a', websiteUrl: 'https://example.test' })), english);
  });
}
