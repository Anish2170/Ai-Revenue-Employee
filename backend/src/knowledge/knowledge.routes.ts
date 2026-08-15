/** Durable knowledge job routes. Build work never depends on this HTTP response staying open. */
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/auth.middleware.js';
import { validateBody } from '../middleware/validate.js';
import { authUserKey, days, hours, rateLimit } from '../middleware/rateLimit.js';
import { assertWebsiteOwnership, OwnershipError } from '../websites/website.service.js';
import * as knowledgeService from './knowledge.service.js';
import { UnsafeUrlError, resolvePublicUrl } from '../security/ssrf.js';

export const knowledgeRouter = Router();
knowledgeRouter.use(requireAuth);
const buildSchema = z.object({ url: z.string().url(), language: z.string().min(2).max(32).optional(), idempotencyKey: z.string().min(8).max(128).optional() });
const knowledgeBuildLimiter = rateLimit([
  { name: 'knowledge_build_user', limit: 5, windowMs: hours(1), key: authUserKey },
  { name: 'knowledge_build_org', limit: 20, windowMs: days(1), key: (req) => req.auth?.organizationId ?? null },
  { name: 'knowledge_build_website', limit: 3, windowMs: hours(1), key: (req) => req.auth?.organizationId ? `${req.auth.organizationId}:${req.params.id}` : null },
]);

knowledgeRouter.post('/api/websites/:id/knowledge/build', knowledgeBuildLimiter, validateBody(buildSchema), async (req, res, next) => {
  try {
    await assertWebsiteOwnership(req.auth!.organizationId, req.params.id);
    const body = req.body as z.infer<typeof buildSchema>;
    await resolvePublicUrl(body.url);
    const result = await knowledgeService.enqueueBuild(req.auth!.organizationId, req.params.id, body.url, req.auth!.userId, body.language, body.idempotencyKey);
    res.status(202).json({ buildId: result.build.id, created: result.created, status: result.build.status });
  } catch (error) {
    if (error instanceof OwnershipError) return res.status(error.status).json({ error: error.code, message: error.message });
    if (error instanceof UnsafeUrlError) return res.status(400).json({ error: 'unsafe_website_url', message: error.message });
    next(error);
  }
});

knowledgeRouter.get('/api/websites/:id/knowledge/build/:buildId', async (req, res, next) => {
  try {
    await assertWebsiteOwnership(req.auth!.organizationId, req.params.id);
    const build = await knowledgeService.getBuildStatus(req.auth!.organizationId, req.params.id, req.params.buildId);
    if (!build) return res.status(404).json({ error: 'build_not_found', message: 'Knowledge build not found.' });
    res.json(build);
  } catch (error) { if (error instanceof OwnershipError) return res.status(error.status).json({ error: error.code, message: error.message }); next(error); }
});

knowledgeRouter.get('/api/websites/:id/knowledge/status', async (req, res, next) => {
  try { await assertWebsiteOwnership(req.auth!.organizationId, req.params.id); res.json(await knowledgeService.getKnowledgeStatus(req.params.id)); }
  catch (error) { if (error instanceof OwnershipError) return res.status(error.status).json({ error: error.code, message: error.message }); next(error); }
});
knowledgeRouter.get('/api/websites/:id/knowledge/builds', async (req, res, next) => {
  try { await assertWebsiteOwnership(req.auth!.organizationId, req.params.id); res.json(await knowledgeService.listBuilds(req.params.id)); }
  catch (error) { if (error instanceof OwnershipError) return res.status(error.status).json({ error: error.code, message: error.message }); next(error); }
});
