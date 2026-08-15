import { createHash } from 'node:crypto';

const REDACTED = '[REDACTED]';
const sensitiveKey = /^(?:password|token|secret|apiKey|accessKey|secretAccessKey|authorization|cookie|set-cookie|csrf|visitorToken|sessionToken|refreshToken|geminiApiKey|databaseUrl|connectionString|prompt|messages|contents|knowledge|chunks|conversation)$/i;
const sensitiveText = /((?:password|token|secret|api[_-]?key|access[_-]?key|secret[_-]?access[_-]?key|authorization|cookie|set-cookie|csrf|visitor[_-]?token|session[_-]?token|refresh[_-]?token|gemini[_-]?api[_-]?key|database[_-]?url|connection[_-]?string)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi;
const bearerToken = /\bbearer\s+[^\s,;]+/gi;
const urlCredentials = /([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+(?::[^\s/@]+)?@/gi;
const knownSecrets = new Set<string>();

export function registerSensitiveValues(values: Array<string | undefined>): void {
  for (const value of values) if (value && value.length >= 4) knownSecrets.add(value);
}

export function sanitizeText(value: string): string {
  let result = value.replace(bearerToken, `Bearer ${REDACTED}`).replace(sensitiveText, `$1${REDACTED}`).replace(urlCredentials, '$1[REDACTED]@');
  for (const secret of knownSecrets) result = result.split(secret).join(REDACTED);
  return result;
}

export function sanitizeForLog(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || value === undefined || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return sanitizeText(value);
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Error) return { name: value.name, message: sanitizeText(value.message) };
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== 'object') return String(value);
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => sanitizeForLog(item, seen));
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    output[key] = sensitiveKey.test(key) ? REDACTED : sanitizeForLog(item, seen);
  }
  return output;
}

/** Stable, non-reversible correlation token for identifiers that are not safe to log raw. */
export function safeIdentifier(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 12);
}
