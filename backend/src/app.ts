import cors from 'cors';
import express, { type Express } from 'express';
import type { Container } from './container.js';
import { errorHandler, notFoundHandler } from './http/middleware/index.js';
import { buildRoutes } from './http/routes.js';

/** Builds the Express application from an already-wired container (no side effects, testable). */
export function createApp(container: Container): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(cors({ origin: container.config.CORS_ORIGIN.split(','), exposedHeaders: ['Idempotency-Key'] }));
  app.use(express.json({ limit: '100kb' }));
  app.use((req, _res, next) => {
    req.valid = {};
    next();
  });
  app.use('/api', buildRoutes(container));
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
