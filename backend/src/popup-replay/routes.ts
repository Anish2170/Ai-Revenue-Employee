import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { prisma } from '../db/prisma.js';
import { requireAuth } from '../auth/auth.middleware.js';
import { requirePrivilegedDashboardRole } from '../auth/authorization.js';
import { rateLimit, minutes, clientIp, authUserKey } from '../middleware/rateLimit.js';
import { REPLAY, SCENARIOS } from './policy.js';
import * as service from './service.js';

export const replayOwnerRouter = Router(), replayRunnerRouter = Router();
const root = '/api/popup-replay';
const uuid = z.string().uuid();
const bounded = z.string().max(2000);
const invoke = (handler: RequestHandler): RequestHandler => async (req, res, next) => {
  try { await handler(req, res, next); }
  catch (error) {
    if (error instanceof service.ReplayError) return void res.status(error.status).json({ error: 'popup_replay', message: error.message });
    if (error instanceof z.ZodError) return void res.status(400).json({ error: 'invalid_replay_request' });
    next(error);
  }
};
const runnerRate = rateLimit([{ name: 'replay_runner_ip', limit: 240, windowMs: minutes(1), key: clientIp }]);
const ownerRate = rateLimit([{ name: 'replay_owner', limit: 90, windowMs: minutes(1), key: authUserKey }]);
replayRunnerRouter.post(`${root}/runner/pair`, rateLimit([{ name: 'replay_pair', limit: 10, windowMs: minutes(1), key: clientIp }]), invoke(async (req, res) => {
  const body = z.object({ pairingCode: z.string().max(100) }).strict().parse(req.body);
  res.setHeader('Cache-Control', 'no-store'); res.json(await service.pairRunner(body.pairingCode));
}));
const runnerAuth: RequestHandler = invoke(async (req, res, next) => {
  const bearer = req.get('authorization')?.match(/^Bearer ([A-Za-z0-9_-]+)$/)?.[1] ?? '';
  res.locals.replayRunner = await service.authenticateRunner(bearer);
  res.setHeader('Cache-Control', 'no-store'); next();
});
replayRunnerRouter.use(`${root}/runner`, runnerRate, runnerAuth);
replayRunnerRouter.post(`${root}/runner/claim`, invoke(async (_req, res) => { res.json({ job: await service.claimRun(res.locals.replayRunner) }); }));
replayRunnerRouter.post(`${root}/runner/runs/:runId/heartbeat`, invoke(async (req, res) => {
  const id = uuid.parse(req.params.runId), body = z.object({ runToken: z.string().max(100) }).strict().parse(req.body);
  await service.authorizedRun(id, res.locals.replayRunner.id, body.runToken);
  await prisma.popupReplayRun.updateMany({ where: { id, status: 'RUNNING', leaseHash: service.tokenHash(body.runToken), batch: { status: 'RUNNING' } }, data: { leaseExpiresAt: new Date(Date.now() + REPLAY.leaseMs) } });
  await prisma.popupReplayRunner.update({ where: { id: res.locals.replayRunner.id }, data: { lastSeenAt: new Date() } });
  res.json({ active: true });
}));
replayRunnerRouter.post(`${root}/runner/runs/:runId/complete`, invoke(async (req, res) => {
  const body = z.object({ runToken: z.string().max(100), result: z.object({ outcome: z.enum(['displayed', 'silent', 'failed']), reason: bounded.optional(), steps: z.array(z.object({ action: z.string().max(100), path: z.string().max(300).optional(), atMs: z.number().min(0).max(180000) }).strict()).max(40), popup: z.object({ title: z.string().max(80), body: z.string().max(320), type: z.string().max(40), cta: z.string().max(80), destination: z.string().max(1000).optional() }).strict().optional(), targetCheck: z.string().max(100).optional() }).strict(), screenshot: z.string().max(550000).optional() }).strict().parse(req.body);
  res.json(await service.finishRun(res.locals.replayRunner.id, uuid.parse(req.params.runId), body.runToken, body.result, body.screenshot ? Buffer.from(body.screenshot, 'base64') : undefined));
}));

replayOwnerRouter.use(root, requireAuth, requirePrivilegedDashboardRole, ownerRate);
replayOwnerRouter.get(root, invoke(async (req, res) => {
  const organizationId = req.auth!.organizationId;
  const [runners, batches] = await Promise.all([
    prisma.popupReplayRunner.findMany({ where: { organizationId }, orderBy: { createdAt: 'desc' }, take: 10 }),
    prisma.popupReplayBatch.findMany({ where: { organizationId }, orderBy: { createdAt: 'desc' }, take: 20, include: { _count: { select: { runs: true } } } }),
  ]);
  res.setHeader('Cache-Control', 'no-store'); res.json({ runners: runners.map(service.publicRunner), batches, scenarios: SCENARIOS });
}));
replayOwnerRouter.post(`${root}/runners`, invoke(async (req, res) => {
  const { name } = z.object({ name: z.string().trim().min(1).max(80) }).strict().parse(req.body);
  res.setHeader('Cache-Control', 'no-store'); res.status(201).json(await service.createRunner(req.auth!.organizationId, req.auth!.userId, name));
}));
replayOwnerRouter.post(`${root}/runners/:id/revoke`, invoke(async (req, res) => {
  const id = uuid.parse(req.params.id), organizationId = req.auth!.organizationId;
  await prisma.$transaction(async tx => {
    if (!(await tx.popupReplayRunner.updateMany({ where: { id, organizationId }, data: { revokedAt: new Date(), tokenHash: null, pairingHash: null } })).count) throw new service.ReplayError(404, 'Runner not found.');
    await tx.popupReplayRun.updateMany({ where: { batch: { runnerId: id, organizationId }, status: { in: ['QUEUED', 'RUNNING'] } }, data: { status: 'CANCELLED', leaseHash: null, finishedAt: new Date() } });
    await tx.popupReplayBatch.updateMany({ where: { runnerId: id, organizationId, status: { in: ['QUEUED', 'RUNNING', 'PAUSED'] } }, data: { status: 'CANCELLED' } });
  }); res.json({ ok: true });
}));
replayOwnerRouter.post(`${root}/batches`, invoke(async (req, res) => {
  const input = z.object({ websiteId: uuid, runnerId: uuid, count: z.number().int().min(1).max(50), scenarios: z.array(z.enum(SCENARIOS)).min(1).max(8), surface: z.enum(['desktop', 'mobile']), budgetMicros: z.number().int().min(10000).max(REPLAY.maxBudgetMicros) }).strict().parse(req.body);
  res.status(201).json(await service.createBatch(req.auth!.organizationId, req.auth!.userId, input));
}));
const runSelection = { id: true, batchId: true, ordinal: true, scenario: true, surface: true, status: true, externalCalls: true, visitorId: true, sessionId: true, trace: true, result: true, rating: true, startedAt: true, finishedAt: true } as const;
replayOwnerRouter.get(`${root}/batches/:id`, invoke(async (req, res) => {
  const batch = await prisma.popupReplayBatch.findFirst({ where: { id: uuid.parse(req.params.id), organizationId: req.auth!.organizationId }, include: { runs: { orderBy: { ordinal: 'asc' }, select: runSelection } } });
  if (!batch) throw new service.ReplayError(404, 'Batch not found.');
  res.setHeader('Cache-Control', 'no-store'); res.json(batch);
}));
replayOwnerRouter.post(`${root}/batches/:id/control`, invoke(async (req, res) => {
  const { operation } = z.object({ operation: z.enum(['stop', 'resume']) }).strict().parse(req.body);
  await service.controlBatch(req.auth!.organizationId, uuid.parse(req.params.id), operation); res.json({ ok: true });
}));
replayOwnerRouter.patch(`${root}/runs/:id/rating`, invoke(async (req, res) => {
  const { rating } = z.object({ rating: z.enum(['HELPFUL', 'GENERIC', 'WRONG_CONTEXT']) }).strict().parse(req.body);
  const changed = await prisma.popupReplayRun.updateMany({ where: { id: uuid.parse(req.params.id), batch: { organizationId: req.auth!.organizationId } }, data: { rating } });
  if (!changed.count) throw new service.ReplayError(404, 'Run not found.'); res.json({ ok: true });
}));
replayOwnerRouter.get(`${root}/runs/:id/screenshot`, invoke(async (req, res) => {
  const run = await prisma.popupReplayRun.findFirst({ where: { id: uuid.parse(req.params.id), batch: { organizationId: req.auth!.organizationId, expiresAt: { gt: new Date() } } }, select: { screenshot: true } });
  if (!run?.screenshot) throw new service.ReplayError(404, 'Screenshot not available.');
  res.setHeader('Cache-Control', 'private, no-store'); res.type('image/jpeg').send(Buffer.from(run.screenshot));
}));
