import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/auth.middleware.js';
import { validateBody } from '../middleware/validate.js';
import { getOrCreateInstructions } from '../instructions/instruction.service.js';
import { assertWebsiteOwnership, OwnershipError } from '../websites/website.service.js';
import * as debugService from './knowledge-debug.service.js';

export const knowledgeDebugRouter = Router();

knowledgeDebugRouter.use(requireAuth);

const searchSchema = z.object({
  question: z.string().min(1),
  messages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string() })).optional(),
  conversationSummary: z.string().optional(),
  conversationMemories: z.array(z.string()).optional(),
});

async function guard(organizationId: string, websiteId: string) {
  await assertWebsiteOwnership(organizationId, websiteId);
}

function handleOwnership(err: unknown, res: { status: (code: number) => { json: (body: unknown) => void } }) {
  if (err instanceof OwnershipError) {
    res.status(err.status).json({ error: err.code, message: err.message });
    return true;
  }
  return false;
}

knowledgeDebugRouter.get('/api/websites/:id/knowledge/debug/overview', async (req, res, next) => {
  try {
    await guard(req.auth!.organizationId, req.params.id);
    res.json(await debugService.getOverview(req.params.id));
  } catch (err) {
    if (!handleOwnership(err, res)) next(err);
  }
});

knowledgeDebugRouter.get('/api/websites/:id/knowledge/debug/pages', async (req, res, next) => {
  try {
    await guard(req.auth!.organizationId, req.params.id);
    res.json(await debugService.listPages(req.params.id, Number(req.query.page), Number(req.query.limit)));
  } catch (err) {
    if (!handleOwnership(err, res)) next(err);
  }
});

knowledgeDebugRouter.get('/api/websites/:id/knowledge/debug/pages/detail', async (req, res, next) => {
  try {
    await guard(req.auth!.organizationId, req.params.id);
    const url = String(req.query.url ?? '');
    if (!url) return res.status(400).json({ error: 'missing_url' });
    const detail = await debugService.getPageDetail(req.params.id, url);
    if (!detail) return res.status(404).json({ error: 'not_found' });
    res.json(detail);
  } catch (err) {
    if (!handleOwnership(err, res)) next(err);
  }
});

knowledgeDebugRouter.get('/api/websites/:id/knowledge/debug/chunks', async (req, res, next) => {
  try {
    await guard(req.auth!.organizationId, req.params.id);
    res.json(await debugService.listChunks(req.params.id, Number(req.query.page), Number(req.query.limit), req.query.pageUrl ? String(req.query.pageUrl) : undefined));
  } catch (err) {
    if (!handleOwnership(err, res)) next(err);
  }
});

knowledgeDebugRouter.get('/api/websites/:id/knowledge/debug/chunks/:chunkId', async (req, res, next) => {
  try {
    await guard(req.auth!.organizationId, req.params.id);
    const detail = await debugService.getChunkDetail(req.params.id, req.params.chunkId);
    if (!detail) return res.status(404).json({ error: 'not_found' });
    res.json(detail);
  } catch (err) {
    if (!handleOwnership(err, res)) next(err);
  }
});

knowledgeDebugRouter.post('/api/websites/:id/knowledge/debug/search-test', validateBody(searchSchema), async (req, res, next) => {
  try {
    await guard(req.auth!.organizationId, req.params.id);
    const instructions = await getOrCreateInstructions(req.auth!.organizationId, req.params.id);
    res.json(await debugService.runSearchTest(req.params.id, { ...req.body, instructions }));
  } catch (err) {
    if (!handleOwnership(err, res)) next(err);
  }
});

knowledgeDebugRouter.get('/api/websites/:id/knowledge/debug/actions', async (req, res, next) => {
  try {
    await guard(req.auth!.organizationId, req.params.id);
    res.json(await debugService.listDiscoveredActions(req.params.id));
  } catch (err) {
    if (!handleOwnership(err, res)) next(err);
  }
});

knowledgeDebugRouter.get('/api/websites/:id/knowledge/debug/quality-checks', async (req, res, next) => {
  try {
    await guard(req.auth!.organizationId, req.params.id);
    res.json(await debugService.qualityChecks(req.params.id));
  } catch (err) {
    if (!handleOwnership(err, res)) next(err);
  }
});

knowledgeDebugRouter.get('/api/websites/:id/knowledge/debug/visual-flow', async (req, res, next) => {
  try {
    await guard(req.auth!.organizationId, req.params.id);
    res.json(await debugService.visualFlow(req.params.id));
  } catch (err) {
    if (!handleOwnership(err, res)) next(err);
  }
});

knowledgeDebugRouter.get('/api/websites/:id/knowledge/debug/export', async (req, res, next) => {
  try {
    await guard(req.auth!.organizationId, req.params.id);
    const format = z.enum(['json', 'markdown', 'txt']).catch('json').parse(req.query.format);
    const exported = await debugService.exportSession(req.params.id, format);
    res.setHeader('Content-Type', exported.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="knowledge-debug-${req.params.id}.${format === 'markdown' ? 'md' : format}"`);
    res.send(exported.body);
  } catch (err) {
    if (!handleOwnership(err, res)) next(err);
  }
});
