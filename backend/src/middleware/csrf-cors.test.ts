import assert from 'node:assert/strict';
import test from 'node:test';
import type { NextFunction, Request, Response } from 'express';
import { config } from '../config/index.js';
import { csrfTokenForSession, requireCsrfForDashboardMutation } from '../auth/auth.middleware.js';
import { corsPolicyFor } from './cors.js';

const dashboardOrigin = config.dashboardOrigins[0] ?? 'http://localhost:3001';
const widgetOrigin = 'https://customer.example';

function mutationRequest(headers: Record<string, string | undefined> = {}, token = 'session-token'): Request {
  return {
    method: 'POST',
    cookies: { [config.sessionCookieName]: token },
    get(name: string) {
      return headers[name.toLowerCase()];
    },
  } as unknown as Request;
}

function responseCapture(): { response: Response; result: { status?: number; body?: unknown } } {
  const result: { status?: number; body?: unknown } = {};
  const response = {
    status(code: number) { result.status = code; return response; },
    json(body: unknown) { result.body = body; return response; },
  } as unknown as Response;
  return { response, result };
}

test('dashboard CORS allows configured dashboard origins with credentials', () => {
  const policy = corsPolicyFor('/api/websites', dashboardOrigin, new Set([dashboardOrigin]), new Set([widgetOrigin]));
  assert.equal(policy.origin, true);
  assert.equal(policy.credentials, true);
});

test('dashboard CORS rejects non-dashboard origins', () => {
  const policy = corsPolicyFor('/api/websites', 'https://attacker.example', new Set([dashboardOrigin]), new Set([widgetOrigin]));
  assert.equal(policy.origin, false);
  assert.equal(policy.credentials, false);
});

test('widget chat and event requests allow a registered customer origin without credentials', () => {
  for (const path of ['/chat', '/events']) {
    const policy = corsPolicyFor(path, widgetOrigin, new Set([dashboardOrigin]), new Set([widgetOrigin]));
    assert.equal(policy.origin, true);
    assert.equal(policy.credentials, false);
  }
});

test('dashboard Test AI can bootstrap identity and call chat without credentials', () => {
  for (const path of ['/widget/session', '/chat']) {
    const policy = corsPolicyFor(path, dashboardOrigin, new Set([dashboardOrigin]), new Set([widgetOrigin]));
    assert.equal(policy.origin, true);
    assert.equal(policy.credentials, false);
  }
});

test('dashboard origin is not added to unrelated widget telemetry routes', () => {
  const policy = corsPolicyFor('/events', dashboardOrigin, new Set([dashboardOrigin]), new Set([widgetOrigin]));
  assert.equal(policy.origin, false);
  assert.equal(policy.credentials, false);
});

test('CSRF middleware rejects missing or invalid tokens', () => {
  for (const csrf of [undefined, 'invalid']) {
    const { response, result } = responseCapture();
    let called = false;
    requireCsrfForDashboardMutation(
      mutationRequest({ origin: dashboardOrigin, 'x-csrf-token': csrf }),
      response,
      (() => { called = true; }) as NextFunction,
    );
    assert.equal(called, false);
    assert.deepEqual(result, {
      status: 403,
      body: { error: { code: 'forbidden', message: 'This action could not be verified. Refresh the page and try again.', requestId: undefined } },
    });
  }
});

test('authenticated dashboard mutation accepts valid origin and CSRF token', () => {
  const sessionToken = 'session-token';
  const { response, result } = responseCapture();
  let called = false;
  requireCsrfForDashboardMutation(
    mutationRequest({ origin: dashboardOrigin, 'x-csrf-token': csrfTokenForSession(sessionToken) }, sessionToken),
    response,
    (() => { called = true; }) as NextFunction,
  );
  assert.equal(called, true);
  assert.deepEqual(result, {});
});

test('authenticated dashboard mutation rejects an unexpected origin', () => {
  const sessionToken = 'session-token';
  const { response, result } = responseCapture();
  requireCsrfForDashboardMutation(
    mutationRequest({ origin: 'https://attacker.example', 'x-csrf-token': csrfTokenForSession(sessionToken) }, sessionToken),
    response,
    (() => { throw new Error('must not continue'); }) as NextFunction,
  );
  assert.deepEqual(result, {
    status: 403,
    body: { error: { code: 'forbidden', message: 'This action is not allowed from this origin.', requestId: undefined } },
  });
});
