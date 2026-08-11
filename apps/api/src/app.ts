import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import type { Database } from '@cubic/database';
import { CUBIC_VERSION } from '@cubic/shared';
import { healthRoutes } from './routes/health.js';

export interface CreateAppOptions {
  pool: Database['pool'];
  corsOrigin: string;
  logger?: boolean;
}

export async function createApp(options: CreateAppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger ?? true,
    trustProxy: true,
    bodyLimit: 2 * 1024 * 1024
  });

  await app.register(cors, {
    origin: options.corsOrigin,
    credentials: true
  });

  app.get('/', async () => ({
    name: 'Cubic API',
    version: CUBIC_VERSION,
    status: 'foundation'
  }));

  await app.register(healthRoutes, {
    prefix: '/api/v1',
    pool: options.pool
  });

  return app;
}
