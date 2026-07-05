/**
 * Widget routes: /api/websites/:id/widget
 */
import { Router } from 'express';
import { requireAuth } from '../auth/auth.middleware.js';
import { OwnershipError } from '../websites/website.service.js';
import { getWidgetView } from './widget.service.js';

export const widgetRouter = Router();

widgetRouter.use(requireAuth);

widgetRouter.get('/api/websites/:id/widget', async (req, res, next) => {
  try {
    const view = await getWidgetView(req.auth!.organizationId, req.params.id);
    res.json(view);
  } catch (err) {
    if (err instanceof OwnershipError) {
      return res.status(err.status).json({ error: err.code, message: err.message });
    }
    next(err);
  }
});
