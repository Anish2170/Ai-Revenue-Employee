/**
 * Password + token hashing helpers. bcrypt for passwords (slow by design),
 * SHA-256 for opaque session/reset tokens (fast lookup, token is high-entropy).
 */
import bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';

const BCRYPT_ROUNDS = 12;

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/** Generate a high-entropy opaque token (returned to the client, e.g. in a cookie). */
export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** Hash a token for at-rest storage (raw token never persisted). */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
