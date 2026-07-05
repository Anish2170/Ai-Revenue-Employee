/**
 * POST /ingest — trigger the knowledge ingestion pipeline for a site URL.
 *
 * Synchronous for Sprint 2 (crawl + embed can take ~30–60s). A future dashboard
 * "Rebuild Knowledge Base" button calls this same endpoint.
 */
import { Router } from 'express';
import { z } from 'zod';
import { validateBody } from '../middleware/validate.js';
import { ingest } from '../services/ingestService.js';

const ingestRequestSchema = z.object({
  url: z.string().url(),
});

export const ingestRouter = Router();

ingestRouter.post('/ingest', validateBody(ingestRequestSchema), async (req, res, next) => {
  try {
    const { url } = req.body as { url: string };
    const result = await ingest(url);
    res.json({ ok: true, ...result });
  } catch (err) {
    next(err);
  }
});
