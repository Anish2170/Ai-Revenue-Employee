/** Operator CLI; dry-run is the default. No HTTP/admin endpoint is exposed. */
import { parseArgs } from 'node:util';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import type { RefreshIdentity, RefreshPlan } from './actionRefresh.js';

export const REFRESH_CLI_HELP = `Action-only refresh (no AI, embeddings or knowledge rebuild)
  npm run actions:refresh -- --mode dry-run --organization-id UUID --website-id UUID --user-id UUID --plan FILE
  npm run actions:refresh -- --mode apply --organization-id UUID --website-id UUID --user-id UUID --plan FILE --review-sha256 SHA256
  npm run actions:refresh -- --mode rollback-dry-run --organization-id UUID --website-id UUID --user-id UUID --plan FILE
  npm run actions:refresh -- --mode rollback-apply --organization-id UUID --website-id UUID --user-id UUID --plan FILE --review-sha256 SHA256

Default mode: dry-run. --plan writes a NEW local JSON file (never overwrites).
Dry-run options: --max-pages 50 --max-requests 200 --max-total-bytes 20971520 --timeout-ms 10000 --total-timeout-ms 120000
Apply re-fetches/revalidates the reviewed plan; changed pages/state require a new dry-run.
Rollback restores the immediate parent graph into a NEW immutable version.
Writes with NODE_ENV=production also require --allow-production-apply.
Run against the existing backend environment, from backend/. Built CLI lives in dist/.
`;

export async function runActionRefreshCli(argv: string[]): Promise<void> {
  const { values } = parseArgs({ args: argv, options: {
    help: { type: 'boolean' }, mode: { type: 'string', default: 'dry-run' },
    'organization-id': { type: 'string' }, 'website-id': { type: 'string' }, 'user-id': { type: 'string' },
    plan: { type: 'string' }, 'review-sha256': { type: 'string' }, 'allow-production-apply': { type: 'boolean' },
    'max-pages': { type: 'string' }, 'max-requests': { type: 'string' }, 'max-total-bytes': { type: 'string' },
    'timeout-ms': { type: 'string' }, 'total-timeout-ms': { type: 'string' },
  }, strict: true, allowPositionals: false });
  if (values.help) { process.stdout.write(REFRESH_CLI_HELP); return; }
  if (!['dry-run', 'apply', 'rollback-dry-run', 'rollback-apply'].includes(values.mode!)) throw Error('INVALID_MODE');
  const { identitySchema, refreshOptionsSchema, createActionRefresh } = await import('./actionRefresh.js');
  const identity: RefreshIdentity = identitySchema.parse({ organizationId: values['organization-id'], websiteId: values['website-id'], userId: values['user-id'] });
  const applying = values.mode === 'apply' || values.mode === 'rollback-apply';
  const { config, hasDatabase } = await import('../config/index.js');
  if (!hasDatabase) throw Error('DATABASE_REQUIRED');
  if (applying && config.nodeEnv === 'production' && !values['allow-production-apply']) throw Error('PRODUCTION_APPLY_FLAG_REQUIRED');
  const { createActionRefreshRepository } = await import('./actionRefresh.repository.js');
  const { prisma } = await import('../db/prisma.js');
  try {
    const tool = createActionRefresh({ repository: createActionRefreshRepository() });
    if (applying) {
      if (!values.plan || !values['review-sha256'] || !/^[a-f0-9]{64}$/.test(values['review-sha256'])) throw Error('PLAN_AND_REVIEW_DIGEST_REQUIRED');
      if ((await stat(values.plan)).size > 4 * 1024 * 1024) throw Error('PLAN_TOO_LARGE');
      const plan = JSON.parse(await readFile(values.plan, 'utf8')) as RefreshPlan;
      const planIdentity = identitySchema.parse(plan.identity);
      if (Object.keys(identity).some(key => identity[key as keyof RefreshIdentity] !== planIdentity[key as keyof RefreshIdentity])) throw Error('PLAN_TENANT_OR_ACTOR_MISMATCH');
      if (plan.operation !== (values.mode === 'rollback-apply' ? 'rollback' : 'refresh')) throw Error('PLAN_OPERATION_MISMATCH');
      process.stdout.write(JSON.stringify(await tool.apply(plan, values['review-sha256']), null, 2) + '\n');
    } else {
      const options = refreshOptionsSchema.parse(Object.fromEntries([
        ['maxPages', values['max-pages']], ['maxRequests', values['max-requests']], ['maxTotalBytes', values['max-total-bytes']],
        ['timeoutMs', values['timeout-ms']], ['totalTimeoutMs', values['total-timeout-ms']],
      ].filter(([, value]) => value !== undefined).map(([key, value]) => [key, Number(value)])));
      const report = await tool.dryRun(identity, values.mode === 'rollback-dry-run' ? 'rollback' : 'refresh', options);
      const json = JSON.stringify(report, null, 2) + '\n';
      if (Buffer.byteLength(json) > 4 * 1024 * 1024) throw Error('PLAN_TOO_LARGE');
      if (values.plan) await writeFile(values.plan, json, { flag: 'wx', mode: 0o600 });
      process.stdout.write(json);
      if (report.blockers.length) process.exitCode = 2;
    }
  } finally { await prisma.$disconnect(); }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  runActionRefreshCli(process.argv.slice(2)).catch(error => {
    // Do not print connection strings, raw Prisma errors or customer HTML.
    const code = error && typeof error.code === 'string' && /^[A-Z_]+$/.test(error.code) ? error.code
      : error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : 'ACTION_REFRESH_FAILED';
    process.stderr.write(`${code}: no success receipt issued; inspect the plan/audit before retrying.\n`);
    process.exitCode = 1;
  });
}
