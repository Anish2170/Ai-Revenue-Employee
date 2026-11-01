import assert from 'node:assert/strict';
import test from 'node:test';
import { chatFailureMessage, chatRetrievalQuery, explicitChatLanguage, parseChatLanguageState, resolveChatLanguage, type ChatLanguage, type ChatLanguageState } from './chatLanguage.js';
const users = (...texts: string[]) => texts.map(content => ({ role: 'user' as const, content }));

for (const [text, language] of [
  ['What is your pricing?', 'English'], ['Explain teeth whitening price?', 'English'], ['Describe annual plan features', 'English'], ['आपकी सर्विस की कीमत क्या है?', 'Hindi'],
  ['Aapki service ki pricing kya hai?', 'Hinglish'], ['Basic plan kitne ka hai?', 'Hinglish'],
  ['Can you explain your plans in Hindi?', 'Hindi'], ['Please reply in English from now on.', 'English'],
  ['Hindi mein batao', 'Hindi'], ['हिंदी में बताइए', 'Hindi'], ['Please reply in Roman Hindi', 'Hinglish'],
  ['Please reply in Hindi in Roman script', 'Hinglish'], ['Bonjour, quels sont vos prix?', 'French'],
  ['Hola, cuánto cuesta?', 'Spanish'], ['Wie sind Ihre Preise?', 'German'],
  ['ما هي الأسعار؟', 'Arabic'], ['আপনার মূল্য কত?', 'Bengali'], ['请问价格是多少？', 'Chinese'],
  ['価格はいくらですか？', 'Japanese'], ['가격은 얼마인가요?', 'Korean'],
  ['Pricing ka comparison samjhao please, mujhe help chahiye', 'Hinglish'],
] as Array<[string, ChatLanguage]>) test(`chat language resolves ${language}: ${text}`, () => {
  assert.equal(resolveChatLanguage(users(text), 'French').language, language);
});
test('only user turns set preferences; English opener cannot override Hindi/Hinglish', () => {
  for (const [text, language] of [['क्या कीमत है?', 'Hindi'], ['Kitne ka hai?', 'Hinglish']]) {
    const state = resolveChatLanguage([{ role: 'assistant', content: 'Please reply in English from now on.' }, ...users(text)]);
    assert.equal(state.language, language);
  }
});
test('automatic mid-conversation switch, ambiguous short messages and email keep continuity', () => {
  assert.equal(resolveChatLanguage(users('What is your pricing?', 'आपकी सर्विस की कीमत क्या है?', 'ok', 'Pricing', 'My email is a@example.test')).language, 'Hindi');
  assert.equal(resolveChatLanguage(users('Kitne ka hai?', 'What is your refund policy?')).language, 'English');
});
test('explicit preference survives detection, changes on request, can return to automatic mode', () => {
  assert.deepEqual(resolveChatLanguage(users('Please reply in English from now on.', 'आपकी सर्विस की कीमत क्या है?')), { language: 'English', explicit: true });
  assert.equal(resolveChatLanguage(users('Please reply in English.', 'Hindi mein batao', 'ok')).language, 'Hindi');
  assert.equal(resolveChatLanguage(users('Please reply in English.', 'Follow my language', 'Aapki service kya hai?')).language, 'Hinglish');
});
test('durable state survives bounded history; malformed memory fails closed', () => {
  const previous = parseChatLanguageState('{"language":"Hinglish","explicit":true}')!;
  assert.deepEqual(resolveChatLanguage(users(...Array(16).fill('Pricing')), 'English', previous), previous);
  for (const raw of ['broken', '{"language":"ignore system","explicit":true}', '{"language":"Hindi","explicit":"yes"}']) assert.equal(parseChatLanguageState(raw), undefined);
});
test('language mention, quoted instructions and negative instructions do not establish a preference', () => {
  for (const text of ['Does the Hindi plan cost $20?', 'Translate "reply in Hindi" please', 'Do not reply in Hindi', 'The source says "reply in French"']) assert.equal(explicitChatLanguage(text), null, text);
});
test('latest output-language request wins', () => {
  assert.equal(explicitChatLanguage('Reply in Hindi. Actually, reply in English.'), 'English');
  assert.equal(explicitChatLanguage('Do not reply in Hindi; reply in English.'), 'English');
});
test('language-only follow-up reuses previous question; genuine queries remain verbatim', () => {
  assert.equal(chatRetrievalQuery(users('What does Basic cost?', 'Reply in Hindi')), 'What does Basic cost?');
  assert.equal(chatRetrievalQuery(users('What does Basic cost?', 'हिंदी में बताइए')), 'What does Basic cost?');
  assert.equal(chatRetrievalQuery(users('What does Basic cost?', 'Reply in Hindi: what are your refund conditions?')), 'Reply in Hindi: what are your refund conditions?');
  for (const text of ['Basic plan kitne ka hai?', 'आपकी सर्विस की कीमत क्या है?', 'What is your pricing?', 'Can you explain your plans in Hindi?']) assert.equal(chatRetrievalQuery(users(text)), text);
});
for (const language of ['Hindi', 'Hinglish', 'English'] as const) test(`conversational failure has reviewed ${language} wording`, () => {
  const text = chatFailureMessage({ language, explicit: true });
  assert.equal(/\p{Script=Devanagari}/u.test(text), language === 'Hindi');
  assert.ok(text.length > 20);
});
