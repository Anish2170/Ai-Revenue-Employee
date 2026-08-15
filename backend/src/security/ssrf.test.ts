import assert from 'node:assert/strict';
import test from 'node:test';
import { UnsafeUrlError, isPublicAddress, resolvePublicUrl, validateRedirectTarget } from './ssrf.js';

const privateDns = async () => [{ address: '10.0.0.8', family: 4 }];
const publicDns = async () => [{ address: '93.184.216.34', family: 4 }];
const blocked = async (url: string) => assert.rejects(() => resolvePublicUrl(url, publicDns), UnsafeUrlError);

test('ssrf: blocks localhost and loopback targets', async () => { await blocked('http://localhost'); await blocked('http://127.0.0.1'); await blocked('http://[::1]'); });
test('ssrf: blocks private, link-local, metadata, multicast and reserved targets', async () => { await blocked('http://10.0.0.1'); await blocked('http://169.254.169.254'); await blocked('http://[fe80::1]'); await blocked('http://metadata.google.internal'); assert.equal(isPublicAddress('224.0.0.1'), false); });
test('ssrf: blocks hostname resolving to a private IP', async () => { await assert.rejects(() => resolvePublicUrl('https://example.test', privateDns), UnsafeUrlError); });
test('ssrf: permits normal public HTTP and HTTPS URLs', async () => { await resolvePublicUrl('http://example.test', publicDns); await resolvePublicUrl('https://example.test', publicDns); });
test('ssrf: permits normal ports and blocks nonstandard ports', async () => { await resolvePublicUrl('http://example.test:80', publicDns); await resolvePublicUrl('https://example.test:443', publicDns); await blocked('https://example.test:8443'); });
test('ssrf: rejects a redirect from a public URL to a private URL', async () => { await assert.rejects(() => validateRedirectTarget(new URL('https://example.test/'), 'http://10.0.0.1', publicDns), UnsafeUrlError); });
