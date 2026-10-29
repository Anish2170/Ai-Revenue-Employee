import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPopupCopyPlan, checkPopupGrounding } from '../popupGrounding.js';
import { resolvePopupAction } from '../popupActionPolicy.js';
import { instructions, knowledge, ownerAction, strategy } from './phase26Fixtures.js';
import { chatPromptBuilder } from '../../prompts/chatPromptBuilder.js';
import type { ResolvedContext } from '../../context/types.js';

for (const language of ['English', 'Hindi', 'Hinglish', 'French', 'German']) {
  test(`language separation: ${language} owner still gets English popup plan`, () => {
    const plan = buildPopupCopyPlan(knowledge('Basic plan costs $20 per month.'), { ...instructions, language });
    assert.equal(plan.language, 'english');
    assert.equal(checkPopupGrounding('Your next step.', 'Basic plan costs $20 per month.', plan).ok, true);
  });
}
for (const [language, title, body] of [
  ['Hindi', 'आपकी मुस्कान।', 'क्या आप अपनी मुस्कान के विकल्प देखना चाहेंगे?'],
  ['Hinglish', 'Aapka ghar, aapki kahaani.', 'Apne ghar ke design par baat karna chahenge?'],
  ['French', 'Votre style, votre histoire.', 'Envie de découvrir votre style ?'],
]) test(`English popup validation rejects ${language} even with matching owner setting`, () => {
  assert.equal(checkPopupGrounding(title, body, buildPopupCopyPlan(knowledge(), { ...instructions, language })).ok, false);
});
for (const label of ['अपनी मुस्कान चुनें', 'Découvrez votre style']) test(`popup CTA rejects non-English owner label: ${label}`, () => {
  const action = ownerAction('view_collection', label, '/collection');
  assert.equal(resolvePopupAction([action], action.actionId, strategy('Educate', 'sell_products'), instructions, false, 'Want help choosing the next step?', { websiteId: 'tenant-a' }), null);
});
for (const [message, language] of [
  ['What is your pricing?', 'English'],
  ['आपकी सर्विस की कीमत क्या है?', 'Hindi'],
  ['Aapki service ki pricing kya hai?', 'Hinglish'],
  ['Can you explain your plans in Hindi?', 'Hindi'],
]) test(`chat has independent visitor language policy: ${language}`, () => {
  const context = { business: { name: 'Example' }, instructions: { ...instructions, language: 'French' }, chunks: [], siteLinks: [] } as unknown as ResolvedContext;
  const prompt = chatPromptBuilder.build(context, [{ role: 'assistant', content: 'Hi! How can I help?' }, { role: 'user', content: message }]);
  assert.match(prompt.system, /CHAT LANGUAGE POLICY/);
  assert.ok(prompt.system.includes(`Reply language: ${language}`));
  assert.ok(!prompt.system.includes('Respond in: French.'));
});
