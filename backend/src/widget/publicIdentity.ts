import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { config } from '../config/index.js';

export type PublicWidgetIdentity = { siteId: string; visitorId: string; sessionId: string; exp: number };

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function signature(payload: string): string {
  return createHmac('sha256', config.sessionSecret).update(`widget-identity.${payload}`).digest('base64url');
}

export function issuePublicWidgetIdentity(siteId: string, visitorToken?: unknown): { identity: PublicWidgetIdentity; token: string } {
  // A previous signed token proves visitor ownership only. Never reuse its session
  // or trust a caller-supplied visitorId. Keep the original 30-day retention bound.
  const previous = verifyPublicWidgetIdentity(visitorToken, siteId);
  const identity = { siteId, visitorId: previous?.visitorId ?? randomUUID(), sessionId: randomUUID(), exp: previous?.exp ?? Date.now() + 30 * 24 * 60 * 60 * 1000 };
  const payload = encode(identity);
  return { identity, token: `${payload}.${signature(payload)}` };
}

export function verifyPublicWidgetIdentity(token: unknown, siteId: string): PublicWidgetIdentity | null {
  if (typeof token !== 'string') return null;
  const [payload, supplied, extra] = token.split('.');
  if (!payload || !supplied || extra !== undefined) return null;
  const expected = signature(payload);
  const suppliedBytes = Buffer.from(supplied);
  const expectedBytes = Buffer.from(expected);
  if (suppliedBytes.length !== expectedBytes.length || !timingSafeEqual(suppliedBytes, expectedBytes)) return null;
  try {
    const identity = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as PublicWidgetIdentity;
    return identity.siteId === siteId && typeof identity.visitorId === 'string' && typeof identity.sessionId === 'string' && identity.exp > Date.now() ? identity : null;
  } catch { return null; }
}

/** Verify the signed identity and every caller-supplied public request binding. */
export function verifyPublicWidgetRequestIdentity(input: {
  siteId: string;
  visitorId: string;
  sessionId: string;
  visitorToken: string;
}): PublicWidgetIdentity | null {
  const identity = verifyPublicWidgetIdentity(input.visitorToken, input.siteId);
  if (!identity || identity.visitorId !== input.visitorId || identity.sessionId !== input.sessionId) return null;
  return identity;
}
