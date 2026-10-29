/**
 * POST /ingest — trigger the knowledge ingestion pipeline for a site URL.
 *
 * Synchronous for Sprint 2 (crawl + embed can take ~30–60s). A future dashboard
 * "Rebuild Knowledge Base" button calls this same endpoint.
 */
import { Router } from 'express';
import { z } from 'zod';
import { validateBody } from '../middleware/validate.js';
import { clientIp, hours, rateLimit } from '../middleware/rateLimit.js';
import { ingest } from '../services/ingestService.js';
import { resolvePublicUrl } from '../security/ssrf.js';
import { config, hasDatabase } from '../config/index.js';

const ingestRequestSchema = z.object({
  url: z.string().url(),
});

export const ingestRouter = Router();

const publicIngestLimiter = rateLimit([
  { name: 'public_ingest_ip', limit: 3, windowMs: hours(1), key: (req) => clientIp(req) },
]);

ingestRouter.post('/ingest', publicIngestLimiter, validateBody(ingestRequestSchema), async (req, res, next) => {
  try {
    // Production/multi-tenant builds must use the authenticated durable queue.
    if(config.isProduction || hasDatabase)return res.status(404).json({error:'Use the authenticated website knowledge build endpoint.'});
    const { url } = req.body as { url: string };
    await resolvePublicUrl(url);
    const result = await ingest(url);
    const {snapshot:_internal,...summary}=result;
    res.json({ ok: true, ...summary });
  } catch (err) {
    next(err);
  }
});
