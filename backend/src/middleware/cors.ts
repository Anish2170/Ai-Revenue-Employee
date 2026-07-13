/**
 * CORS configuration.
 *
 * Production must use an explicit allowlist. Development keeps the historical
 * wildcard default so local widget testing can happen from arbitrary pages.
 */
import cors from 'cors';
import { config } from '../config/index.js';

const allowedHeaders = ['Content-Type', 'Authorization'];

export const corsMiddleware = cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);

    if (!config.isProduction && config.corsOrigin === '*') {
      return callback(null, true);
    }

    if (config.allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    return callback(null, false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders,
});
