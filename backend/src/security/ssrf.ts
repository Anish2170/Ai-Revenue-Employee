/** SSRF guard for all server-side requests to customer supplied website URLs. */
import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import http from 'node:http';
import https from 'node:https';

const SAFE_MESSAGE = 'This website URL cannot be reached from the service. Please use a public HTTP or HTTPS website.';
const ALLOWED_PORTS = new Set(['', '80', '443']);
const MAX_REDIRECTS = 5;

export class UnsafeUrlError extends Error {
  constructor() {
    super(SAFE_MESSAGE);
    this.name = 'UnsafeUrlError';
  }
}

export type Lookup = (hostname: string) => Promise<Array<{ address: string; family: number }>>;
const defaultLookup: Lookup = (hostname) => dnsLookup(hostname, { all: true, verbatim: true });

export function parseAndValidateUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new UnsafeUrlError(); }
  if (!['http:', 'https:'].includes(url.protocol) || !ALLOWED_PORTS.has(url.port) || url.username || url.password) throw new UnsafeUrlError();
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host === 'metadata' || host.endsWith('.metadata') || host === 'metadata.google.internal') throw new UnsafeUrlError();
  return url;
}

export async function resolvePublicUrl(value: string | URL, lookup: Lookup = defaultLookup): Promise<{ url: URL; addresses: string[] }> {
  const url = typeof value === 'string' ? parseAndValidateUrl(value) : parseAndValidateUrl(value.toString());
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const literalFamily = isIP(hostname);
  const records = literalFamily ? [{ address: hostname, family: literalFamily }] : await lookup(hostname).catch(() => { throw new UnsafeUrlError(); });
  if (!records.length || records.some((record) => !isPublicAddress(record.address))) throw new UnsafeUrlError();
  return { url, addresses: records.map((record) => record.address) };
}

/** Validates DNS then pins the request to a just-validated address (DNS rebinding safe). */
export async function safeFetch(urlValue: string | URL, options: { timeoutMs: number; headers?: Record<string, string> } ): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer; url: string }> {
  let current = typeof urlValue === 'string' ? urlValue : urlValue.toString();
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    const resolved = await resolvePublicUrl(current);
    const response = await requestPinned(resolved.url, resolved.addresses[0], options);
    const location = response.headers.location;
    if (isRedirect(response.status) && location) {
      if (redirects === MAX_REDIRECTS) throw new UnsafeUrlError();
      current = (await validateRedirectTarget(resolved.url, Array.isArray(location) ? location[0] : location)).url.toString();
      continue;
    }
    return { ...response, url: resolved.url.toString() };
  }
  throw new UnsafeUrlError();
}

/** Exported so every redirect-bearing client can use the exact same policy. */
export async function validateRedirectTarget(base: URL, location: string, lookup: Lookup = defaultLookup): Promise<{ url: URL; addresses: string[] }> {
  return resolvePublicUrl(new URL(location, base), lookup);
}

async function requestPinned(url: URL, address: string, options: { timeoutMs: number; headers?: Record<string, string> }): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
  const transport = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const request = transport.request({
      protocol: url.protocol,
      hostname: address,
      port: url.port || undefined,
      path: `${url.pathname}${url.search}`,
      method: 'GET',
      headers: { Host: url.host, ...options.headers },
      servername: url.hostname,
      lookup: (_host, _opts, callback) => callback(null, address, isIP(address) === 6 ? 6 : 4),
      timeout: options.timeoutMs,
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
      response.on('end', () => resolve({ status: response.statusCode ?? 0, headers: response.headers, body: Buffer.concat(chunks) }));
    });
    request.on('timeout', () => request.destroy(new Error('Request timed out.')));
    request.on('error', reject);
    request.end();
  });
}

function isRedirect(status: number): boolean { return [301, 302, 303, 307, 308].includes(status); }

export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const [a, b] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 0 || b === 168)) || (a === 198 && (b === 18 || b === 19 || b === 51)) || (a === 203 && b === 0) || a >= 224);
  }
  if (family !== 6) return false;
  const normalized = address.toLowerCase();
  if (normalized === '::' || normalized === '::1' || normalized.startsWith('fc') || normalized.startsWith('fd') || /^fe[89ab]/.test(normalized) || normalized.startsWith('ff') || normalized.startsWith('2001:db8')) return false;
  const mapped = normalized.match(/^(?:0*:)*ffff:(\d+\.\d+\.\d+\.\d+)$/);
  return !mapped || isPublicAddress(mapped[1]);
}
