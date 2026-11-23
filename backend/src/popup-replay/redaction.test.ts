import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeForLog, sanitizeText } from '../logging/sanitize.js';
test('replay credentials are redacted in objects and textual errors', () => {
  const secrets = { pairingCode: 'pair-code-value', runToken: 'run-lease-value', 'x-popup-replay': 'run-id.private-lease', pairingHash: 'pair-hash', tokenHash: 'token-hash', leaseHash: 'lease-hash' };
  const object = JSON.stringify(sanitizeForLog({ ...secrets, outcome: 'DISPLAYED' }));
  for (const value of Object.values(secrets)) assert.ok(!object.includes(value));
  const message = sanitizeText('pairingCode=pair-code-value runToken=run-lease-value x-popup-replay=run-id.private-lease');
  for (const value of Object.values(secrets).slice(0, 3)) assert.ok(!message.includes(value));
  assert.match(object, /DISPLAYED/);
});
