/**
 * Express server entrypoint.
 *
 * Sprint 3: adds cookie-parser, credentialed CORS for the dashboard, auth
 * routes, and all tenant resource routers alongside the original widget routes.
 */
import express from 'express';
import cookieParser from 'cookie-parser';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { config, hasLLM, hasDatabase } from './config/index.js';
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
import { analyticsRouter } from './analytics/analytics.routes.js';
import { conversationRouter, widgetConversationRouter } from './conversations/conversation.routes.js';
import { knowledgeReady, loadOnBoot } from './vectorstore/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, '..', 'public');

const app = express();

// --- Middleware ---
app.use(corsMiddleware);
app.use(express.json({ limit: '64kb' }));
app.use(cookieParser());

// --- Health check ---
app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    llm: hasLLM,
    database: hasDatabase,
    model: config.gemini.model,
    embeddingModel: config.gemini.embeddingModel,
    knowledgeReady: knowledgeReady(),
    env: config.nodeEnv,
  });
});

// --- Public widget routes (no auth, siteId-scoped) ---
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
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('widget.js')) {
        res.setHeader('Cache-Control', 'no-store, max-age=0');
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
app.use(conversationRouter);

app.use(notFound);
app.use(errorHandler);

// Load the persisted knowledge snapshot (dev singleton) before accepting traffic.
await loadOnBoot();

app.listen(config.port, () => {
  console.log(`\n  AI Revenue Employee backend`);
  console.log(`  → http://localhost:${config.port}`);
  console.log(`  → playground: http://localhost:${config.port}/playground.html`);
  console.log(`  → chat/engage model: ${config.gemini.model}  |  embeddings: ${config.gemini.embeddingModel}`);
  console.log(`  → knowledge: ${knowledgeReady() ? 'RAG index loaded' : 'static fallback (run POST /ingest)'}`);
  console.log(`  → database: ${hasDatabase ? 'connected (multi-tenant)' : 'not configured (dev-fallback)'}`);
  if (!hasLLM) {
    console.log('  ⚠  GEMINI_API_KEY missing — /engage returns showPopup:false, /chat & /ingest disabled.');
  }
  console.log('');
});
