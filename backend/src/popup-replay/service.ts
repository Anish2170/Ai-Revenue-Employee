import { createHash, randomBytes } from 'node:crypto';
import type { Prisma, PopupReplayRun } from '@prisma/client';
import { prisma } from '../db/prisma.js';
import { REPLAY, buildRunPlan, classifyReplayOutcome, hashableTokenPattern, safeWebsiteUrl, SILENCE_SCENARIOS, type ReplayScenario } from './policy.js';
import { resolvePublicUrl } from '../security/ssrf.js';

export class ReplayError extends Error { constructor(public status: number, message: string) { super(message); } }
export const tokenHash = (value: string) => createHash('sha256').update(value).digest('hex');
const token = () => randomBytes(32).toString('base64url');
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
export const rows = (value: Prisma.JsonValue): Record<string, unknown>[] => Array.isArray(value) ? value.filter(v => v && typeof v === 'object') as Record<string, unknown>[] : [];
export const publicRunner = (r: { id: string; name: string; lastSeenAt: Date | null; revokedAt: Date | null; expiresAt: Date }) => ({ id: r.id, name: r.name, lastSeenAt: r.lastSeenAt, online: !r.revokedAt && r.expiresAt > new Date() && !!r.lastSeenAt && Date.now() - r.lastSeenAt.getTime() < 30000, expiresAt: r.expiresAt, revoked: !!r.revokedAt });
export function publicRun(run: PopupReplayRun) { const { screenshot, leaseHash, ...safe } = run; return { ...safe, hasScreenshot: !!screenshot }; }

export async function ownedSite(organizationId: string, id: string) {
  const site = await prisma.website.findFirst({ where: { id, organizationId, deletedAt: null }, include: { widget: true } });
  if (!site?.widget || site.widget.status !== 'ACTIVE') throw new ReplayError(404, 'Active website widget not found.');
  safeWebsiteUrl(site.url);
  await resolvePublicUrl(site.url);
  return site;
}
export async function createRunner(organizationId: string, userId: string, name: string) {
  if (await prisma.popupReplayRunner.count({ where: { organizationId, revokedAt: null, expiresAt: { gt: new Date() } } }) >= 5) throw new ReplayError(409, 'Revoke an unused runner before pairing another.');
  const pairingCode = token();
  const runner = await prisma.popupReplayRunner.create({ data: { organizationId, createdBy: userId, name, pairingHash: tokenHash(pairingCode), pairingExpiresAt: new Date(Date.now() + 600000), expiresAt: new Date(Date.now() + 86400000) } });
  return { runner: publicRunner(runner), pairingCode, pairingExpiresAt: runner.pairingExpiresAt };
}
export async function pairRunner(code: string) {
  if (!hashableTokenPattern.test(code)) throw new ReplayError(403, 'Invalid or expired pairing code.');
  const runner = await prisma.popupReplayRunner.findUnique({ where: { pairingHash: tokenHash(code) } });
  if (!runner || runner.revokedAt || !runner.pairingExpiresAt || runner.pairingExpiresAt < new Date() || runner.expiresAt < new Date()) throw new ReplayError(403, 'Invalid or expired pairing code.');
  const bearer = token();
  const changed = await prisma.popupReplayRunner.updateMany({ where: { id: runner.id, pairingHash: tokenHash(code), revokedAt: null, pairingExpiresAt: { gt: new Date() } }, data: { pairingHash: null, pairingExpiresAt: null, tokenHash: tokenHash(bearer), lastSeenAt: new Date() } });
  if (changed.count !== 1) throw new ReplayError(403, 'Pairing code has already been used.');
  return { runnerId: runner.id, token: bearer, expiresAt: runner.expiresAt };
}
export async function authenticateRunner(bearer: string) {
  if (!hashableTokenPattern.test(bearer)) throw new ReplayError(401, 'Runner authentication required.');
  const runner = await prisma.popupReplayRunner.findUnique({ where: { tokenHash: tokenHash(bearer) } });
  if (!runner || runner.revokedAt || runner.expiresAt < new Date()) throw new ReplayError(401, 'Runner has expired or was revoked.');
  return runner;
}
export async function createBatch(organizationId: string, userId: string, input: { websiteId: string; runnerId: string; count: number; scenarios: ReplayScenario[]; surface: 'desktop' | 'mobile'; budgetMicros: number }) {
  await ownedSite(organizationId, input.websiteId);
  const runner = await prisma.popupReplayRunner.findFirst({ where: { id: input.runnerId, organizationId, revokedAt: null, expiresAt: { gt: new Date() }, lastSeenAt: { gt: new Date(Date.now() - 30000) } } });
  if (!runner) throw new ReplayError(409, 'Connect your local runner before starting.');
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "PopupReplayRunner" WHERE id=${runner.id}::uuid FOR UPDATE`;
    if (await tx.popupReplayBatch.count({ where: { runnerId: runner.id, status: { in: ['QUEUED', 'RUNNING', 'PAUSED'] } } })) throw new ReplayError(409, 'Finish or stop the existing runner batch first.');
    const plan = buildRunPlan(input.scenarios, input.count, input.surface);
    return tx.popupReplayBatch.create({ data: { organizationId, websiteId: input.websiteId, runnerId: runner.id, createdBy: userId, budgetMicros: input.budgetMicros, config: json({ scenarios: input.scenarios, surface: input.surface, count: input.count, pilotRuns: Math.min(5, input.count) }), expiresAt: new Date(Date.now() + REPLAY.retentionMs), runs: { create: plan } }, select: { id: true, status: true } });
  });
}
export async function claimRun(runner: { id: string; organizationId: string }) {
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "PopupReplayRunner" WHERE id=${runner.id}::uuid FOR UPDATE`;
    await tx.popupReplayRunner.update({ where: { id: runner.id }, data: { lastSeenAt: new Date() } });
    const active = await tx.popupReplayRun.findFirst({ where: { batch: { runnerId: runner.id }, status: 'RUNNING' } });
    if (active) {
      if (active.leaseExpiresAt && active.leaseExpiresAt < new Date()) {
        await tx.popupReplayRun.update({ where: { id: active.id }, data: { status: 'FAILED', finishedAt: new Date(), leaseHash: null, result: json({ reason: 'runner_disconnected', outcome: 'failed' }) } });
        await tx.popupReplayBatch.updateMany({ where: { id: active.batchId, status: 'RUNNING' }, data: { status: 'PAUSED' } });
      }
      return null;
    }
    const batch = await tx.popupReplayBatch.findFirst({ where: { runnerId: runner.id, organizationId: runner.organizationId, status: { in: ['QUEUED', 'RUNNING'] }, expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'asc' } });
    if (!batch) return null;
    const next = await tx.popupReplayRun.findFirst({ where: { batchId: batch.id, status: 'QUEUED' }, orderBy: { ordinal: 'asc' } });
    if (!next) { await tx.popupReplayBatch.update({ where: { id: batch.id }, data: { status: 'COMPLETED' } }); return null; }
    if (batch.reservedMicros >= batch.budgetMicros) { await tx.popupReplayBatch.update({ where: { id: batch.id }, data: { status: 'BUDGET_STOP' } }); return null; }
    const site = await tx.website.findFirst({ where: { id: batch.websiteId, organizationId: batch.organizationId, deletedAt: null }, include: { widget: true } });
    if (!site?.widget || site.widget.status !== 'ACTIVE') throw new ReplayError(409, 'Website is no longer active.');
    const url = safeWebsiteUrl(site.url);
    const runToken = token();
    await tx.popupReplayRun.update({ where: { id: next.id }, data: { status: 'RUNNING', startedAt: new Date(), leaseHash: tokenHash(runToken), leaseExpiresAt: new Date(Date.now() + REPLAY.leaseMs) } });
    await tx.popupReplayBatch.update({ where: { id: batch.id }, data: { status: 'RUNNING' } });
    return { id: next.id, batchId: batch.id, ordinal: next.ordinal, scenario: next.scenario, surface: next.surface, runToken, websiteUrl: url.href, siteId: site.widget.siteId, timeoutMs: 120000 };
  });
}
export async function authorizedRun(runId: string, runnerId: string, runToken: string) {
  const run = await prisma.popupReplayRun.findFirst({ where: { id: runId, batch: { runnerId }, leaseHash: tokenHash(runToken) }, include: { batch: { include: { runner: true } } } });
  if (!run || run.status !== 'RUNNING' || !run.leaseExpiresAt || run.leaseExpiresAt < new Date() || run.batch.status !== 'RUNNING' || run.batch.expiresAt < new Date() || run.batch.runner.revokedAt || run.batch.runner.expiresAt < new Date()) throw new ReplayError(409, 'Replay run is no longer active.');
  return run;
}
export async function appendTrace(runId: string, event: Record<string, unknown>) {
  // Append in SQL to avoid losing simultaneous decision/context/receipt events.
  await prisma.$executeRaw`UPDATE "PopupReplayRun" SET trace=trace || ${JSON.stringify([{ ...event, at: new Date().toISOString() }])}::jsonb WHERE id=${runId}::uuid AND jsonb_array_length(trace)<100`;
}
export async function finishRun(runnerId: string, runId: string, runToken: string, result: Record<string, unknown>, screenshot?: Buffer) {
  const run = await authorizedRun(runId, runnerId, runToken);
  if (screenshot && (screenshot.length > REPLAY.maxScreenshotBytes || screenshot[0] !== 0xff || screenshot[1] !== 0xd8 || screenshot[screenshot.length - 2] !== 0xff || screenshot[screenshot.length - 1] !== 0xd9)) throw new ReplayError(400, 'Invalid JPEG screenshot.');
  const receipt = rows(run.trace).find(e => e.kind === 'lifecycle' && e.operation === 'displayed' && e.ok === true);
  const displayed = !!receipt;
  const generated = rows(run.trace).find(e => e.kind === 'decision' && e.decisionId === receipt?.popupId && e.popup);
  const actual = generated?.popup as { title?: string; body?: string } | undefined;
  const reported = result.popup as { title?: string; body?: string; type?: string } | undefined;
  const copyMatches = !!actual && !!reported && actual.title === reported.title && actual.body === reported.body && generated?.popupType === reported.type;
  const correctBlock = rows(run.trace).some(event => event.blockedReason === run.scenario || event.reason === run.scenario);
  const status = classifyReplayOutcome(run.scenario, String(result.outcome), displayed, correctBlock, copyMatches, rows(run.trace).some(e => e.kind === 'signals' && Number(e.accepted) > 0));
  await prisma.$transaction(async tx => {
    const changed = await tx.popupReplayRun.updateMany({ where: { id: run.id, status: 'RUNNING', leaseHash: tokenHash(runToken), batch: { status: 'RUNNING' } }, data: { status, finishedAt: new Date(), leaseHash: null, result: json({ ...result, serverDisplayConfirmed: displayed, hasScreenshot: !!screenshot }), ...(screenshot ? { screenshot: new Uint8Array(screenshot) } : {}) } });
    if (!changed.count) throw new ReplayError(409, 'Replay run has already finished or was stopped.');
    if (['FAILED', 'UNEXPECTED_POPUP'].includes(status)) await tx.popupReplayBatch.update({ where: { id: run.batchId }, data: { status: 'PAUSED' } });
    else {
      const pilot = await tx.popupReplayRun.findMany({ where: { batchId: run.batchId, ordinal: { lte: REPLAY.pilotRuns } }, select: { status: true, scenario: true } });
      const pilotDone = pilot.every(item => !['QUEUED', 'RUNNING'].includes(item.status));
      if (run.ordinal <= REPLAY.pilotRuns && pilotDone && pilot.some(item => !SILENCE_SCENARIOS.has(item.scenario)) && !pilot.some(item => item.status === 'DISPLAYED')) await tx.popupReplayBatch.update({ where: { id: run.batchId }, data: { status: 'PAUSED' } });
      else if (!await tx.popupReplayRun.count({ where: { batchId: run.batchId, status: 'QUEUED' } })) await tx.popupReplayBatch.update({ where: { id: run.batchId }, data: { status: 'COMPLETED' } });
    }
  });
  return { status };
}
export async function controlBatch(organizationId: string, id: string, operation: 'stop' | 'resume') {
  return prisma.$transaction(async tx => {
    const batch = await tx.popupReplayBatch.findFirst({ where: { id, organizationId } });
    if (!batch) throw new ReplayError(404, 'Batch not found.');
    if (operation === 'resume') {
      if (batch.status !== 'PAUSED') throw new ReplayError(409, 'Only a paused batch can resume.');
      return tx.popupReplayBatch.update({ where: { id }, data: { status: 'QUEUED' } });
    }
    await tx.popupReplayRun.updateMany({ where: { batchId: id, status: { in: ['QUEUED', 'RUNNING'] } }, data: { status: 'CANCELLED', leaseHash: null, finishedAt: new Date() } });
    return tx.popupReplayBatch.update({ where: { id }, data: { status: 'CANCELLED' } });
  });
}
export async function reserveCall(runId: string, quote: number, detail: Record<string, unknown>) {
  if (!Number.isSafeInteger(quote) || quote <= 0 || quote > REPLAY.maxBudgetMicros) throw new ReplayError(400, 'Invalid cost reservation.');
  const allowed = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "PopupReplayRun" WHERE id=${runId}::uuid FOR UPDATE`;
    const run = await tx.popupReplayRun.findUnique({ where: { id: runId }, include: { batch: { include: { runner: true } } } });
    if (!run || run.status !== 'RUNNING' || !run.leaseExpiresAt || run.leaseExpiresAt < new Date() || run.batch.status !== 'RUNNING' || run.batch.expiresAt < new Date() || run.batch.runner.expiresAt < new Date() || run.batch.runner.revokedAt || run.externalCalls >= REPLAY.maxCallsPerRun) throw new ReplayError(409, 'Replay stopped, expired, or reached its per-run call limit.');
    const reserved = await tx.popupReplayBatch.updateMany({ where: { id: run.batchId, status: 'RUNNING', reservedMicros: { lte: run.batch.budgetMicros - quote }, externalCalls: { lt: REPLAY.maxCallsPerBatch } }, data: { reservedMicros: { increment: quote }, externalCalls: { increment: 1 } } });
    if (!reserved.count) {
      await tx.popupReplayBatch.update({ where: { id: run.batchId }, data: { status: 'BUDGET_STOP' } });
      await tx.popupReplayRun.update({ where: { id: runId }, data: { status: 'FAILED', finishedAt: new Date(), leaseHash: null, result: json({ outcome: 'failed', reason: 'budget_or_call_limit' }) } });
      return false;
    }
    await tx.popupReplayRun.update({ where: { id: runId }, data: { externalCalls: { increment: 1 } } });
    await tx.$executeRaw`UPDATE "PopupReplayRun" SET trace=trace || ${JSON.stringify([{ kind: 'call_reserved', ...detail, reservedMicros: quote, at: new Date().toISOString() }])}::jsonb WHERE id=${runId}::uuid`;
    return true;
  });
  if (!allowed) throw new ReplayError(409, 'Replay budget or call limit reached.');
}

/** Only replay-owned records expire; no website/customer data is touched. */
export async function sweepReplayArtifacts() {
  const stale = await prisma.popupReplayRun.findMany({ where: { status: 'RUNNING', leaseExpiresAt: { lt: new Date() } }, take: 20, select: { id: true, batchId: true } });
  for (const run of stale) await prisma.$transaction(async tx => {
    const changed = await tx.popupReplayRun.updateMany({ where: { id: run.id, status: 'RUNNING', leaseExpiresAt: { lt: new Date() } }, data: { status: 'FAILED', leaseHash: null, finishedAt: new Date(), result: json({ outcome: 'failed', reason: 'runner_lease_expired' }) } });
    if (changed.count) await tx.popupReplayBatch.updateMany({ where: { id: run.batchId, status: 'RUNNING' }, data: { status: 'PAUSED' } });
  });
  const expired = await prisma.popupReplayBatch.findMany({ where: { expiresAt: { lt: new Date() } }, take: 20, select: { id: true } });
  if (expired.length) await prisma.popupReplayBatch.deleteMany({ where: { id: { in: expired.map(row => row.id) }, expiresAt: { lt: new Date() } } });
}
