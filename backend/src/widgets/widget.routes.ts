/**
 * Widget routes: /api/websites/:id/widget
 */
import { Router } from 'express';
import { requireAuth } from '../auth/auth.middleware.js';
import { authUserKey, hours, minutes, rateLimit } from '../middleware/rateLimit.js';
import { OwnershipError } from '../websites/website.service.js';
import { getWidgetView, verifyWidgetInstallation } from './widget.service.js';

export const widgetRouter = Router();

const dashboardWidgetLimiter = rateLimit([
  { name: 'dashboard_widget_user', limit: 600, windowMs: minutes(1), key: authUserKey },
]);

const widgetVerifyLimiter = rateLimit([
  { name: 'widget_verify_website', limit: 20, windowMs: hours(1), key: (req) => (req.auth?.organizationId ? `${req.auth.organizationId}:${req.params.id}` : null) },
]);

widgetRouter.use(requireAuth, dashboardWidgetLimiter);

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
widgetRouter.post('/api/websites/:id/widget/verify', widgetVerifyLimiter, async (req, res, next) => {
  try {
    const result = await verifyWidgetInstallation(req.auth!.organizationId, req.params.id);
    res.json(result);
  } catch (err) {
    if (err instanceof OwnershipError) {
      return res.status(err.status).json({ error: err.code, message: err.message });
    }
    next(err);
  }
});

