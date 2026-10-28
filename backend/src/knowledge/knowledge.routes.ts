/** Durable knowledge job routes. Build work never depends on this HTTP response staying open. */
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/auth.middleware.js';
import { validateBody } from '../middleware/validate.js';
import { authUserKey, days, hours, rateLimit } from '../middleware/rateLimit.js';
import { assertWebsiteOwnership, getWebsite, OwnershipError } from '../websites/website.service.js';
import * as knowledgeService from './knowledge.service.js';
import { UnsafeUrlError, resolvePublicUrl } from '../security/ssrf.js';
import { requireRole, requirePrivilegedDashboardRole } from '../auth/authorization.js';
import { crawlBudgetSchema, ScopeError } from './crawlScope.js';

export const knowledgeRouter = Router();
knowledgeRouter.use(requireAuth);
const buildSchema = z.object({ url: z.string().url(), language: z.string().min(2).max(32).optional(), idempotencyKey: z.string().min(8).max(128).optional(), budget: crawlBudgetSchema.optional() }).strict();
const scopeSchema = z.object({ reviewHash: z.string().regex(/^[a-f0-9]{64}$/), excludedUrls: z.array(z.string().url().max(4096)).min(1).max(100),
  reason: z.string().trim().min(12).max(500), acknowledgeLimitations: z.literal(true), budget: crawlBudgetSchema }).strict();
const knowledgeBuildLimiter = rateLimit([
  { name: 'knowledge_build_user', limit: 5, windowMs: hours(1), key: authUserKey },
  { name: 'knowledge_build_org', limit: 20, windowMs: days(1), key: (req) => req.auth?.organizationId ?? null },
  { name: 'knowledge_build_website', limit: 3, windowMs: hours(1), key: (req) => req.auth?.organizationId ? `${req.auth.organizationId}:${req.params.id}` : null },
]);

knowledgeRouter.post('/api/websites/:id/knowledge/build', requirePrivilegedDashboardRole, knowledgeBuildLimiter, validateBody(buildSchema), async (req, res, next) => {
  try {
    await assertWebsiteOwnership(req.auth!.organizationId, req.params.id);
    const body = req.body as z.infer<typeof buildSchema>;
    const website=await getWebsite(req.auth!.organizationId,req.params.id);
    if(!website || new URL(website.url).origin!==new URL(body.url).origin)return res.status(400).json({error:'source_origin_mismatch',message:'Build from the configured website origin; update the website URL first if it has changed.'});
    await resolvePublicUrl(body.url);
    const result = await knowledgeService.enqueueBuild(req.auth!.organizationId, req.params.id, body.url, req.auth!.userId, body.language, body.idempotencyKey, body.budget);
    res.status(202).json({ buildId: result.build.id, created: result.created, status: result.build.status });
  } catch (error) {
    if (error instanceof OwnershipError) return res.status(error.status).json({ error: error.code, message: error.message });
    if (error instanceof UnsafeUrlError) return res.status(400).json({ error: 'unsafe_website_url', message: error.message });
    if (error instanceof ScopeError) return res.status(error.status).json({ error: 'scope_review_required', message: error.message });
    next(error);
  }
});

knowledgeRouter.get('/api/websites/:id/knowledge/build/:buildId/scope-review', requireRole('OWNER'), async (req, res, next) => {
  try {
    await assertWebsiteOwnership(req.auth!.organizationId, req.params.id);
    res.json(await knowledgeService.getScopeReview(req.auth!.organizationId, req.params.id, req.params.buildId));
  } catch (error) {
    if (error instanceof OwnershipError || error instanceof ScopeError) return res.status(error.status).json({ error: 'scope_review_unavailable', message: error.message });
    next(error);
  }
});
knowledgeRouter.post('/api/websites/:id/knowledge/build/:buildId/approve-scope', requireRole('OWNER'), knowledgeBuildLimiter, validateBody(scopeSchema), async (req, res, next) => {
  try {
    await assertWebsiteOwnership(req.auth!.organizationId, req.params.id);
    const result = await knowledgeService.enqueueReviewedBuild(req.auth!.organizationId, req.params.id, req.params.buildId, req.auth!.userId, req.body);
    res.status(202).json({ buildId: result.build.id, created: result.created, status: result.build.status });
  } catch (error) {
    if (error instanceof OwnershipError || error instanceof ScopeError) return res.status(error.status).json({ error: 'scope_review_required', message: error.message });
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
knowledgeRouter.get('/api/websites/:id/knowledge/build/:buildId/manifest', async(req,res,next)=>{
  try{await assertWebsiteOwnership(req.auth!.organizationId,req.params.id);const manifest=await knowledgeService.getBuildManifest(req.auth!.organizationId,req.params.id,req.params.buildId);if(!manifest)return res.status(404).json({error:'manifest_not_available'});res.json(manifest);}
  catch(error){if(error instanceof OwnershipError)return res.status(error.status).json({error:error.code,message:error.message});next(error);}
});
knowledgeRouter.post('/api/websites/:id/knowledge/build/:buildId/cancel',async(req,res,next)=>{
  try{await assertWebsiteOwnership(req.auth!.organizationId,req.params.id);const result=await knowledgeService.cancelBuild(req.auth!.organizationId,req.params.id,req.params.buildId);res.json({cancelled:result.count===1});}
  catch(error){if(error instanceof OwnershipError)return res.status(error.status).json({error:error.code,message:error.message});next(error);}
});
knowledgeRouter.get('/api/websites/:id/knowledge/builds', async (req, res, next) => {
  try { await assertWebsiteOwnership(req.auth!.organizationId, req.params.id); res.json(await knowledgeService.listBuilds(req.params.id)); }
  catch (error) { if (error instanceof OwnershipError) return res.status(error.status).json({ error: error.code, message: error.message }); next(error); }
});
