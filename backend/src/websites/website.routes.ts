/**
 * Website routes: /api/websites — CRUD, all behind requireAuth + ownership.
 */
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/auth.middleware.js';
import { validateBody } from '../middleware/validate.js';
import * as websiteService from './website.service.js';

export const websiteRouter = Router();

const createSchema = z.object({
  name: z.string().min(1).max(120),
  url: z.string().url().max(500),
  industry: z.string().max(80).optional(),
  primaryLanguage: z.string().max(40).optional(),
  description: z.string().max(500).optional(),
});

const updateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  url: z.string().url().max(500).optional(),
  industry: z.string().max(80).optional(),
  primaryLanguage: z.string().max(40).optional(),
  description: z.string().max(500).optional(),
});

websiteRouter.use(requireAuth);

websiteRouter.get('/api/websites', async (req, res, next) => {
  try {
    const websites = await websiteService.listWebsites(req.auth!.organizationId);
    res.json(websites);
  } catch (err) {
    next(err);
  }
});

websiteRouter.post('/api/websites', validateBody(createSchema), async (req, res, next) => {
  try {
    const website = await websiteService.createWebsite(req.auth!.organizationId, req.auth!.userId, req.body);
    res.status(201).json(website);
  } catch (err) {
    next(err);
  }
});

websiteRouter.get('/api/websites/:id', async (req, res, next) => {
  try {
    await websiteService.assertWebsiteOwnership(req.auth!.organizationId, req.params.id);
    const website = await websiteService.getWebsite(req.auth!.organizationId, req.params.id);
    res.json(website);
  } catch (err) {
    if (err instanceof websiteService.OwnershipError) {
      return res.status(err.status).json({ error: err.code, message: err.message });
    }
    next(err);
  }
});

websiteRouter.patch('/api/websites/:id', validateBody(updateSchema), async (req, res, next) => {
  try {
    await websiteService.assertWebsiteOwnership(req.auth!.organizationId, req.params.id);
    await websiteService.updateWebsite(req.auth!.organizationId, req.auth!.userId, req.params.id, req.body);
    const updated = await websiteService.getWebsite(req.auth!.organizationId, req.params.id);
    res.json(updated);
  } catch (err) {
    if (err instanceof websiteService.OwnershipError) {
      return res.status(err.status).json({ error: err.code, message: err.message });
    }
    next(err);
  }
});

websiteRouter.delete('/api/websites/:id', async (req, res, next) => {
  try {
    await websiteService.assertWebsiteOwnership(req.auth!.organizationId, req.params.id);
    await websiteService.deleteWebsite(req.auth!.organizationId, req.auth!.userId, req.params.id);
    res.status(204).end();
  } catch (err) {
    if (err instanceof websiteService.OwnershipError) {
      return res.status(err.status).json({ error: err.code, message: err.message });
    }
    next(err);
  }
});
