import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { errorHandler, notFound } from './errorHandler.js';

function responseCapture() {
  const result: { status?: number; body?: unknown } = {};
  const response = { headersSent: false, status(code: number) { result.status = code; return this; }, json(body: unknown) { result.body = body; return this; } };
  return { response, result };
}

test('safe API errors include a request id and map invalid, missing, oversized, and internal requests', () => {
  for (const [error, expectedStatus, expectedCode] of [
    [{ status: 400 }, 400, 'invalid_request'],
    [{ status: 413 }, 413, 'payload_too_large'],
    [new Error('provider secret'), 500, 'internal_error'],
  ] as const) {
    const { response, result } = responseCapture();
    errorHandler(error, { path: '/api/test', method: 'POST', requestId: 'req-safe' } as never, response as never, (() => undefined) as never);
    assert.deepEqual(result, { status: expectedStatus, body: { error: { code: expectedCode, message: expectedStatus === 413 ? 'The request is too large.' : expectedStatus === 400 ? 'The request could not be processed.' : 'Something went wrong. Please try again.', requestId: 'req-safe' } } });
  }
  const { response, result } = responseCapture();
  notFound({ requestId: 'req-safe' } as never, response as never);
  assert.deepEqual(result, { status: 404, body: { error: { code: 'not_found', message: 'The requested resource was not found.', requestId: 'req-safe' } } });
});

test('production error responses omit stack traces, paths, secrets, prompts, and customer knowledge', () => {
  const cwd = resolve(process.cwd());
  const script = `
    import { errorHandler } from './src/middleware/errorHandler.ts';
    const response = { headersSent: false, statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
    errorHandler(new Error('boom at C:\\\\internal\\\\app.ts DATABASE_URL=postgres://u:p@db raw customer knowledge raw prompt content'), { path: '/chat', method: 'POST', requestId: 'req-test' }, response, () => {});
    process.stdout.write(JSON.stringify({ status: response.statusCode, body: response.body }));
  `;
  const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', script], {
    cwd, env: { ...process.env, NODE_ENV: 'production', DATABASE_URL: 'postgres://configured', GEMINI_API_KEY: 'AIza-configured', SESSION_SECRET: 'x'.repeat(32), WIDGET_BASE_URL: 'https://widget.example', CORS_ORIGIN: 'https://dashboard.example' }, encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  const output = result.stdout;
  assert.match(output, /"status":500/);
  assert.match(output, /"code":"internal_error"/);
  assert.match(output, /"requestId":"req-test"/);
  for (const unsafe of ['C:\\\\internal', 'postgres://u:p@db', 'raw customer knowledge', 'raw prompt content', 'stack']) assert.equal(output.includes(unsafe), false);
});
