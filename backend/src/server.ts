/**
 * Express server entrypoint.
 *
 * Sprint 3: adds cookie-parser, credentialed CORS for the dashboard, auth
 * routes, and all tenant resource routers alongside the original widget routes.
 */
import express from 'express';
import cookieParser from 'cookie-parser';
import compression from 'compression';
import helmet from 'helmet';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { config, hasLLM, hasDatabase, validateProductionConfig } from './config/index.js';
import { prisma } from './db/prisma.js';
import { corsMiddleware } from './middleware/cors.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';
import { engageRouter } from './routes/engage.js';
import { eventsRouter } from './routes/events.js';
import { chatRouter } from './routes/chat.js';
import { ingestRouter } from './routes/ingest.js';
import { debugRouter } from './routes/debug.js';
import { authRouter } from './auth/auth.routes.js';
import { websiteRouter } from './websites/website.routes.js';
import { instructionRouter } from './instructions/instruction.routes.js';
import { widgetRouter } from './widgets/widget.routes.js';
import { knowledgeRouter } from './knowledge/knowledge.routes.js';
import { knowledgeDebugRouter } from './knowledge/knowledge-debug.routes.js';
import { analyticsRouter } from './analytics/analytics.routes.js';
import { conversationRouter, widgetConversationRouter } from './conversations/conversation.routes.js';
import { businessActionRouter } from './business-actions/action.routes.js';
import { leadRouter } from './leads/lead.routes.js';
import { publicIdentityRouter } from './widget/publicIdentity.routes.js';
import { knowledgeReady, loadOnBoot } from './vectorstore/index.js';
import { startKnowledgeBuildWorker, stopKnowledgeBuildWorker } from './knowledge/knowledge.worker.js';
import { installSanitizedConsole } from './logging/logger.js';
import { requestLogging } from './middleware/requestLogging.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, '..', 'public');

const app = express();
installSanitizedConsole();
app.disable('x-powered-by');
app.set('trust proxy', 1);

// --- Middleware ---
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  }),
);
app.use(
  compression({
    filter: (req, res) => {
      if (req.path === '/chat' || req.path.endsWith('/knowledge/build')) return false;
      return compression.filter(req, res);
    },
  }),
);
app.use(corsMiddleware);
app.use(express.json({ limit: '64kb' }));
app.use(cookieParser());
app.use(requestLogging);

// --- Health check ---
app.get('/health', (_req, res) => {
  // Liveness must not fail during a temporary database or provider outage.
  // Production configuration is validated before the listener starts; detailed
  // dependency failures are logged and surfaced through normal request paths.
  const databaseStatus = hasDatabase ? 'configured' : 'not_configured';
  const llmStatus = hasLLM ? 'configured' : 'not_configured';

  res.status(200).json({
    status: 'ok',
    services: {
      database: { status: databaseStatus },
      llm: {
        status: llmStatus,
        provider: config.llm.primary.provider,
        model: config.llm.primary.model,
        fallbackProvider: config.llm.fallback.provider,
        fallbackModel: config.llm.fallback.model,
        embeddingModel: config.gemini.embeddingModel,
      },
      knowledge: { ready: knowledgeReady() },
    },
    environment: config.nodeEnv,
    version: config.version,
  });
});

// --- Public widget routes (no auth, siteId-scoped) ---
app.use(publicIdentityRouter);
app.use(engageRouter);
app.use(eventsRouter);
app.use(chatRouter);
app.use(widgetConversationRouter);
app.use(ingestRouter);
app.use(debugRouter);
app.use(analyticsRouter);

// --- Static: /widget.js and /playground.html (before auth routers) ---
app.use(
  express.static(publicDir, {
    fallthrough: true,
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('widget.js')) {
        res.setHeader('Cache-Control', 'no-store, max-age=0');
        res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
      } else if (filePath.endsWith('.html')) {
        res.setHeader('Cache-Control', 'no-store, max-age=0');
      } else {
        res.setHeader('Cache-Control', 'public, max-age=3600');
      }
    },
  }),
);

// --- Dashboard routes (auth + ownership) ---
app.use(authRouter);
app.use(websiteRouter);
app.use(instructionRouter);
app.use(widgetRouter);
app.use(knowledgeRouter);
app.use(knowledgeDebugRouter);
app.use(conversationRouter);
app.use(businessActionRouter);
app.use(leadRouter);

app.use(notFound);
app.use(errorHandler);

validateProductionConfig();

// Load the persisted knowledge snapshot before accepting traffic.
await loadOnBoot();
startKnowledgeBuildWorker();

const server = app.listen(config.port, config.host, () => {
  console.info('[startup] AI Revenue Employee backend ready', {
    host: config.host,
    port: config.port,
    env: config.nodeEnv,
    version: config.version,
    database: hasDatabase ? 'configured' : 'not_configured',
    llm: hasLLM ? 'configured' : 'not_configured',
    knowledgeReady: knowledgeReady(),
  });
});

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.info(`[shutdown] received ${signal}; closing HTTP server`);
  const forceExit = setTimeout(() => {
    console.error('[shutdown] timed out; forcing exit');
    process.exit(1);
  }, 10000);
  forceExit.unref();
  stopKnowledgeBuildWorker();

  server.close(async (err) => {
    if (err) console.error('[shutdown] server close failed', err instanceof Error ? err.message : String(err));
    await prisma.$disconnect();
    clearTimeout(forceExit);
    process.exit(err ? 1 : 0);
  });
}

let shuttingDown = false;
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

