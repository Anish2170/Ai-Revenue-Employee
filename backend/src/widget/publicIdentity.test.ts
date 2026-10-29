import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import { config } from '../config/index.js';
import { chatRequestSchema, engageRequestSchema } from '../validation/requestSchemas.js';
import { issuePublicWidgetIdentity, verifyPublicWidgetIdentity, verifyPublicWidgetRequestIdentity, type PublicWidgetIdentity } from './publicIdentity.js';

function signedToken(identity: PublicWidgetIdentity): string {
  const payload = Buffer.from(JSON.stringify(identity)).toString('base64url');
  const signature = createHmac('sha256', config.sessionSecret)
    .update(`widget-identity.${payload}`)
    .digest('base64url');
  return `${payload}.${signature}`;
}

const issued = issuePublicWidgetIdentity('site-valid');
const validIdentityRequest = {
  siteId: issued.identity.siteId,
  visitorId: issued.identity.visitorId,
  sessionId: issued.identity.sessionId,
  visitorToken: issued.token,
};

test('chat and engage schemas require the complete public widget identity', () => {
  const chat = { ...validIdentityRequest, messages: [{ role: 'user', content: 'Hello' }] };
  const engage = { ...validIdentityRequest, behaviour: {} };
  assert.equal(chatRequestSchema.safeParse(chat).success, true);
  assert.equal(engageRequestSchema.safeParse(engage).success, true);

  for (const field of ['siteId', 'visitorId', 'sessionId', 'visitorToken'] as const) {
    const chatWithout = { ...chat };
    const engageWithout = { ...engage };
    delete chatWithout[field];
    delete engageWithout[field];
    assert.equal(chatRequestSchema.safeParse(chatWithout).success, false, `chat must reject missing ${field}`);
    assert.equal(engageRequestSchema.safeParse(engageWithout).success, false, `engage must reject missing ${field}`);
  }
});

test('valid signed and fully bound widget request identity is accepted', () => {
  assert.deepEqual(verifyPublicWidgetRequestIdentity(validIdentityRequest), issued.identity);
});

test('invalid widget token signature is rejected', () => {
  assert.equal(verifyPublicWidgetRequestIdentity({ ...validIdentityRequest, visitorToken: `${issued.token}corrupt` }), null);
});

test('expired widget token is rejected', () => {
  const identity = { ...issued.identity, exp: Date.now() - 1 };
  assert.equal(verifyPublicWidgetRequestIdentity({ ...identity, visitorToken: signedToken(identity) }), null);
});

test('wrong-site widget token is rejected', () => {
  assert.equal(verifyPublicWidgetRequestIdentity({ ...validIdentityRequest, siteId: 'site-other' }), null);
});

test('wrong-visitor widget token is rejected', () => {
  assert.equal(verifyPublicWidgetRequestIdentity({ ...validIdentityRequest, visitorId: 'visitor-other' }), null);
});

test('wrong-session widget token is rejected', () => {
  assert.equal(verifyPublicWidgetRequestIdentity({ ...validIdentityRequest, sessionId: 'session-other' }), null);
});

test('resuming a signed visitor issues a fresh session without extending visitor retention', () => {
  const resumed = issuePublicWidgetIdentity('site-valid', issued.token);
  assert.equal(resumed.identity.visitorId, issued.identity.visitorId);
  assert.notEqual(resumed.identity.sessionId, issued.identity.sessionId);
  assert.equal(resumed.identity.exp, issued.identity.exp);
  assert.deepEqual(verifyPublicWidgetIdentity(resumed.token, 'site-valid'), resumed.identity);
  assert.equal(verifyPublicWidgetRequestIdentity({ ...validIdentityRequest, sessionId: resumed.identity.sessionId }), null);
  assert.equal(verifyPublicWidgetRequestIdentity({ ...validIdentityRequest, visitorToken: resumed.token }), null);
});

for (const [name, token] of [
  ['tampered', `${issued.token}corrupt`],
  ['wrong site', issuePublicWidgetIdentity('site-other').token],
  ['expired', signedToken({ ...issued.identity, exp: Date.now() - 1 })],
  ['malformed Unicode signature', `${issued.token.split('.')[0]}.${'é'.repeat(43)}`],
  ['extra token segment', `${issued.token}.extra`],
] as const) {
  test(`visitor resume rejects ${name} proof and issues an unrelated identity`, () => {
    const fresh = issuePublicWidgetIdentity('site-valid', token);
    assert.notEqual(fresh.identity.visitorId, issued.identity.visitorId);
    assert.notEqual(fresh.identity.sessionId, issued.identity.sessionId);
    assert.deepEqual(verifyPublicWidgetIdentity(fresh.token, 'site-valid'), fresh.identity);
  });
}
