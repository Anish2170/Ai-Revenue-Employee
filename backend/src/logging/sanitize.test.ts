import assert from 'node:assert/strict';
import test from 'node:test';
import { sanitizeForLog, sanitizeText } from './sanitize.js';

test('sanitizeForLog redacts sensitive keys recursively while keeping operational fields', () => {
  const source = {
    method: 'POST', path: '/chat', status: 500, requestId: 'req-1', websiteId: 'site-1',
    authorization: 'Bearer top-secret', cookie: 'aire_session=session-cookie', csrf: 'csrf-value',
    visitorToken: 'visitor-token', password: 'correct-horse', geminiApiKey: 'AIza-secret',
    r2: { secretAccessKey: 'r2-secret', accessKey: 'r2-access' },
    databaseUrl: 'postgresql://user:password@internal/db', prompt: 'customer knowledge must not be logged by callers',
    nested: [{ sessionToken: 'session-token', retryCount: 2 }],
  };
  const output = JSON.stringify(sanitizeForLog(source));
  for (const secret of ['top-secret', 'session-cookie', 'csrf-value', 'visitor-token', 'correct-horse', 'AIza-secret', 'r2-secret', 'r2-access', 'postgresql://user:password@internal/db', 'session-token']) {
    assert.equal(output.includes(secret), false, `leaked ${secret}`);
  }
  assert.match(output, /"method":"POST"/);
  assert.match(output, /"requestId":"req-1"/);
  assert.match(output, /"retryCount":2/);
});

test('sanitizeText redacts credentials embedded in error messages', () => {
  const output = sanitizeText('provider failed authorization=Bearer abc123 cookie=aire_session=xyz DATABASE_URL=postgres://user:pass@host/db');
  assert.equal(output.includes('abc123'), false);
  assert.equal(output.includes('aire_session=xyz'), false);
  assert.equal(output.includes('postgres://user:pass@host/db'), false);
});

test('debug trace payloads redact prompt and visitor content while retaining counts', () => {
  const output = JSON.stringify(sanitizeForLog({ prompt: 'raw prompt content', visitorToken: 'visitor-token', retryCount: 1 }));
  assert.equal(output.includes('raw prompt content'), false);
  assert.equal(output.includes('visitor-token'), false);
  assert.match(output, /retryCount/);
});
