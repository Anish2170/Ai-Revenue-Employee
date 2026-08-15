import assert from 'node:assert/strict';
import test from 'node:test';
import type { NextFunction, Request, Response } from 'express';
import { requireActiveMembership, requirePrivilegedDashboardRole } from './authorization.js';

function request(role?: 'OWNER' | 'ADMIN' | 'MEMBER'): Request {
  return {
    auth: role ? { userId: 'user', organizationId: 'organization', role } : undefined,
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

test('active membership policy rejects missing authentication', () => {
  const { response, result } = responseCapture();
  requireActiveMembership(request(), response, (() => { throw new Error('must not continue'); }) as NextFunction);
  assert.deepEqual(result, { status: 401, body: { error: 'unauthenticated' } });
});

for (const role of ['OWNER', 'ADMIN'] as const) {
  test(`${role} can access privileged dashboard routes`, () => {
    const { response, result } = responseCapture();
    let called = false;
    requirePrivilegedDashboardRole(request(role), response, (() => { called = true; }) as NextFunction);
    assert.equal(called, true);
    assert.deepEqual(result, {});
  });
}

test('MEMBER cannot access privileged dashboard routes', () => {
  const { response, result } = responseCapture();
  requirePrivilegedDashboardRole(request('MEMBER'), response, (() => { throw new Error('must not continue'); }) as NextFunction);
  assert.deepEqual(result, { status: 403, body: { error: 'forbidden' } });
});
