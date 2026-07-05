/**
 * CORS configuration.
 *
 * The widget runs on arbitrary customer origins → allow any origin for
 * non-credentialed requests. The dashboard sends cookies → allow credentials
 * only from DASHBOARD_ORIGIN.
 */
import cors from 'cors';
import { config } from '../config/index.js';

export const corsMiddleware = cors({
  origin: (origin, callback) => {
    // Dashboard origin gets credentialed access
    if (origin === config.dashboardOrigin) {
      return callback(null, true);
    }
    // Widget requests (any origin, no credentials)
    if (config.corsOrigin === '*') {
      return callback(null, true);
    }
    const allowed = config.corsOrigin.split(',').map((o) => o.trim()).filter(Boolean);
    if (!origin || allowed.includes(origin)) {
      return callback(null, true);
    }
    callback(null, false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
});
