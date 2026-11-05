import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/auth.middleware.js';
import { requirePrivilegedDashboardRole } from '../auth/authorization.js';
import { validateBody } from '../middleware/validate.js';
import { authUserKey, minutes, rateLimit } from '../middleware/rateLimit.js';
import { writeAuditLog } from '../audit/audit.service.js';
import { getOrCreateInstructions } from '../instructions/instruction.service.js';
import { streamChatReply } from '../services/chatService.js';
import * as sources from './sources.service.js';
import type { BusinessInstructions, ResolvedContext } from '../context/types.js';

export const knowledgeSourcesRouter = Router();
const root = '/api/websites/:id/knowledge';
knowledgeSourcesRouter.use(requireAuth);
const limit = rateLimit([{ name: 'knowledge_source_mutations', limit: 60, windowMs: minutes(1), key: authUserKey }]);
const previewLimit = rateLimit([{ name: 'knowledge_source_preview', limit: 15, windowMs: minutes(1), key: authUserKey }]);
const run = (handler: RequestHandler): RequestHandler => async (req, res, next) => {
  try {
    if (!z.string().uuid().safeParse(req.params.id).success || req.params.sourceId && !z.string().uuid().safeParse(req.params.sourceId).success)
      return void res.status(400).json({ error: 'invalid_id', message: 'Invalid website or source identifier.' });
    await handler(req, res, next);
    if (req.method !== 'GET' && !req.path.endsWith('/preview') && res.statusCode < 400)
      void writeAuditLog({ action: 'knowledge.source.changed', organizationId: req.auth!.organizationId, userId: req.auth!.userId,
        targetType: 'website', targetId: req.params.id, metadata: { operation: req.method, sourceId: req.params.sourceId ?? null } }).catch(() => console.warn('[knowledge-sources] Audit write deferred.'));
  } catch (error) {
    if (error instanceof sources.SourceError) return void res.status(error.status).json({ error: 'knowledge_source_error', message: error.message });
    next(error);
  }
};
const text = z.string().trim().min(1).max(sources.MAX_CONTENT_CHARS);
const title = z.string().trim().min(1).max(200);
knowledgeSourcesRouter.get(`${root}/sources`, run(async (req, res) => { res.json(await sources.sourceInventory(req.auth!.organizationId, req.params.id)); }));
knowledgeSourcesRouter.get(`${root}/sources/:sourceId`, run(async (req, res) => { res.json(await sources.sourceDetail(req.auth!.organizationId, req.params.id, req.params.sourceId)); }));
knowledgeSourcesRouter.post(`${root}/sources/page`, requirePrivilegedDashboardRole, limit, validateBody(z.object({ url: z.string().url().max(4096), refresh: z.boolean().default(true) }).strict()), run(async (req, res) => {
  const source = await sources.ensurePageSource(req.auth!.organizationId, req.params.id, req.body.url);
  res.status(req.body.refresh ? 202 : 200).json(req.body.refresh ? await sources.queueSource(req.auth!.organizationId, req.params.id, source.id) : { id: source.id });
}));
knowledgeSourcesRouter.post(`${root}/sources/text`, requirePrivilegedDashboardRole, limit, validateBody(z.object({ title, content: text }).strict()), run(async (req, res) => {
  res.status(202).json(await sources.addTextSource(req.auth!.organizationId, req.params.id, req.body.title, req.body.content));
}));
knowledgeSourcesRouter.post(`${root}/sources/upload`, requirePrivilegedDashboardRole, limit, validateBody(z.object({ name: title, data: z.string().max(7_000_000) }).strict()), run(async (req, res) => {
  res.status(202).json(await sources.addFileSource(req.auth!.organizationId, req.params.id, req.body.name, req.body.data));
}));
knowledgeSourcesRouter.post(`${root}/sources/:sourceId/refresh`, requirePrivilegedDashboardRole, limit, run(async (req, res) => {
  res.status(202).json(await sources.queueSource(req.auth!.organizationId, req.params.id, req.params.sourceId));
}));
knowledgeSourcesRouter.patch(`${root}/sources/:sourceId`, requirePrivilegedDashboardRole, limit,
  validateBody(z.object({ enabled: z.boolean().optional(), priority: z.number().int().min(0).max(100).optional(), title: title.optional(), restore: z.boolean().optional(), content: text.optional() }).strict()), run(async (req, res) => {
    const result = await sources.setSourcePolicy(req.auth!.organizationId, req.params.id, req.params.sourceId, req.body);
    res.status(result.status === 'QUEUED' ? 202 : 200).json(result);
  }));
knowledgeSourcesRouter.delete(`${root}/sources/:sourceId`, requirePrivilegedDashboardRole, limit, run(async (req, res) => {
  res.json(await sources.setSourcePolicy(req.auth!.organizationId, req.params.id, req.params.sourceId, { remove: true }));
}));
knowledgeSourcesRouter.patch(`${root}/source-settings`, requirePrivilegedDashboardRole, limit,
  validateBody(z.object({ refreshHours: z.union([z.literal(0), z.literal(24), z.literal(168)]) }).strict()), run(async (req, res) => {
    res.json(await sources.configureSourceRefresh(req.auth!.organizationId, req.params.id, req.body.refreshHours));
  }));
knowledgeSourcesRouter.post(`${root}/preview`, requirePrivilegedDashboardRole, previewLimit,
  validateBody(z.object({ question: z.string().trim().min(1).max(2000) }).strict()), run(async (req, res) => {
    const site = await sources.ownedWebsite(req.auth!.organizationId, req.params.id);
    const saved = await getOrCreateInstructions(req.auth!.organizationId, req.params.id);
    const instructions: BusinessInstructions = { businessName: saved.businessName, tone: saved.tone, language: saved.language,
      alwaysBookDemo: saved.alwaysBookDemo, avoidDiscounts: saved.avoidDiscounts, websiteUrl: site.url,
      companyDescription: saved.companyDescription ?? undefined, role: saved.role ?? undefined, goal: saved.goal ?? undefined,
      context: saved.context ?? undefined, rules: saved.rules ?? undefined, fallbackMessage: saved.fallbackMessage ?? undefined };
    const controller = new AbortController(), deadline = setTimeout(() => controller.abort(), 55000);
    const disconnect = () => { if (!res.writableEnded) controller.abort(); };
    res.on('close', disconnect);
    try {
      const tenant = { websiteId: site.id, instructions, businessActions: [] };
      let context: ResolvedContext | undefined;
      let answer = '';
      const stream = await streamChatReply({ messages: [{ role: 'user', content: req.body.question }], tenant, signal: controller.signal,
        onContextResolved: resolved => { context = resolved; },
        leadCaptureAvailable: false, allowLeadInvitation: false });
      for await (const event of stream) if (event.type === 'token') answer += event.text;
      res.json({ answer, sources: (context?.chunks ?? []).map(chunk => ({ id: chunk.id, sourceId: chunk.knowledgeSourceId ?? null,
        title: chunk.title, url: chunk.sourceKind === 'FILE' || chunk.sourceKind === 'TEXT' ? null : chunk.url,
        kind: chunk.sourceKind ?? 'PAGE', content: chunk.content, score: chunk.score })), diagnostics: context?.retrieval ?? null });
    } finally { clearTimeout(deadline); res.off('close', disconnect); }
  }));
