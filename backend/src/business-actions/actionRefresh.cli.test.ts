import assert from 'node:assert/strict';
import test from 'node:test';
import { runActionRefreshCli } from './actionRefresh.cli.js';

test('CLI help is read-only and documents explicit apply and rollback gates', async t => {
  let output = '';
  t.mock.method(process.stdout, 'write', (text: string) => { output += text; return true; });
  await runActionRefreshCli(['--help']);
  assert.match(output, /Default mode: dry-run/); assert.match(output, /--review-sha256/);
  assert.match(output, /--allow-production-apply/); assert.match(output, /rollback-dry-run/);
});

test('CLI rejects unknown modes/flags before loading a database connection', async () => {
  await assert.rejects(runActionRefreshCli(['--mode', 'rebuild']), /INVALID_MODE/);
  await assert.rejects(runActionRefreshCli(['--rebuild']), /Unknown option/);
});
