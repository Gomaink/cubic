import type { FastifyPluginAsync } from 'fastify';
import { CUBIC_VERSION, type HealthResponse } from '@cubic/shared';
import { checkDatabase, type Database } from '@cubic/database';

export interface HealthRoutesOptions {
  pool: Database['pool'];
}

export const healthRoutes: FastifyPluginAsync<HealthRoutesOptions> = async (app, options) => {
  app.get('/health', { config: { rateLimit: false } }, async (_request, reply) => {
    const databaseUp = await checkDatabase(options.pool);

    const payload: HealthResponse = {
      status: databaseUp ? 'ok' : 'degraded',
      service: 'cubic-api',
      version: CUBIC_VERSION,
      database: databaseUp ? 'up' : 'down',
      auth: 'ready',
      timestamp: new Date().toISOString()
    };

    return reply.code(databaseUp ? 200 : 503).send(payload);
  });

  app.get('/ready', { config: { rateLimit: false } }, async (_request, reply) => {
    const databaseUp = await checkDatabase(options.pool);
    return reply.code(databaseUp ? 200 : 503).send({ ready: databaseUp });
  });
};
