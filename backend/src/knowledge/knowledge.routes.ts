/**
 * Knowledge routes: /api/websites/:id/knowledge
 *
 * - POST /build — trigger a KB rebuild (SSE progress stream)
 * - GET /status — current knowledge state + last build
 * - GET /builds — build history
 */
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/auth.middleware.js';
import { validateBody } from '../middleware/validate.js';
import { assertWebsiteOwnership, OwnershipError } from '../websites/website.service.js';
import * as knowledgeService from './knowledge.service.js';

export const knowledgeRouter = Router();

knowledgeRouter.use(requireAuth);

const buildSchema = z.object({
  url: z.string().url(),
});

/** POST /api/websites/:id/knowledge/build — SSE progress stream. */
knowledgeRouter.post(
  '/api/websites/:id/knowledge/build',
  validateBody(buildSchema),
  async (req, res) => {
    try {
      await assertWebsiteOwnership(req.auth!.organizationId, req.params.id);
    } catch (err) {
      if (err instanceof OwnershipError) {
        return res.status(err.status).json({ error: err.code, message: err.message });
      }
      return res.status(500).json({ error: 'internal' });
    }

    // SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const send = (event: string, data: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    try {
      const { url } = req.body as { url: string };
      const { buildId, events } = await knowledgeService.startBuild(
        req.auth!.organizationId,
        req.params.id,
        url,
        req.auth!.userId,
      );

      send('build:start', { buildId });

      for await (const event of events) {
        if (event.detail?.error) {
          send('build:error', { phase: event.phase, error: event.detail.error });
        } else if (event.detail?.done) {
          send('build:complete', event.detail);
        } else {
          send('build:phase', { phase: event.phase, ...event.detail });
        }
      }

      send('build:done', { buildId });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      send('build:error', { error: message });
    } finally {
      res.end();
    }
  },
);

/** GET /api/websites/:id/knowledge/status */
knowledgeRouter.get('/api/websites/:id/knowledge/status', async (req, res, next) => {
  try {
    await assertWebsiteOwnership(req.auth!.organizationId, req.params.id);
    const status = await knowledgeService.getKnowledgeStatus(req.params.id);
    res.json(status);
  } catch (err) {
    if (err instanceof OwnershipError) {
      return res.status(err.status).json({ error: err.code, message: err.message });
    }
    next(err);
  }
});

/** GET /api/websites/:id/knowledge/builds */
knowledgeRouter.get('/api/websites/:id/knowledge/builds', async (req, res, next) => {
  try {
    await assertWebsiteOwnership(req.auth!.organizationId, req.params.id);
    const builds = await knowledgeService.listBuilds(req.params.id);
    res.json(builds);
  } catch (err) {
    if (err instanceof OwnershipError) {
      return res.status(err.status).json({ error: err.code, message: err.message });
    }
    next(err);
  }
});
