import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import type { Database } from '@cubic/database';
import { CUBIC_VERSION } from '@cubic/shared';
import { authRoutes } from './routes/auth.js';
import { healthRoutes } from './routes/health.js';
import { userRoutes } from './routes/users.js';
import { socialRoutes } from './routes/social.js';
import { conversationRoutes } from './routes/conversations.js';
import { createRealtimeEvents, type RealtimeEvents } from './realtime/events.js';

export interface CreateAppOptions {
  database: Database;
  corsOrigin: string;
  trustProxyHops: number;
  cookieName: string;
  cookieSecure: boolean;
  sessionTtlDays: number;
  registrationEnabled: boolean;
  logger?: boolean;
  realtimeEvents?: RealtimeEvents;
}

export async function createApp(options: CreateAppOptions): Promise<FastifyInstance> {
  const realtimeEvents = options.realtimeEvents ?? createRealtimeEvents();
  const app = Fastify({
    logger: options.logger ?? true,
    trustProxy: options.trustProxyHops,
    bodyLimit: 2 * 1024 * 1024
  });

  await app.register(cookie);

  await app.register(cors, {
    origin: options.corsOrigin,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS']
  });

  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: '1 minute'
  });

  app.decorateRequest('auth', null);

  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'no-referrer');
    reply.header('x-frame-options', 'DENY');
    return payload;
  });

  app.get('/', async () => ({
    name: 'Cubic API',
    version: CUBIC_VERSION,
    status: 'conversation-ready'
  }));

  await app.register(healthRoutes, {
    prefix: '/api/v1',
    pool: options.database.pool
  });

  await app.register(authRoutes, {
    prefix: '/api/v1/auth',
    database: options.database,
    cookieName: options.cookieName,
    cookieSecure: options.cookieSecure,
    sessionTtlDays: options.sessionTtlDays,
    registrationEnabled: options.registrationEnabled
  });

  await app.register(userRoutes, {
    prefix: '/api/v1/users',
    database: options.database,
    cookieName: options.cookieName
  });

  await app.register(socialRoutes, {
    prefix: '/api/v1/social',
    database: options.database,
    cookieName: options.cookieName
  });

  await app.register(conversationRoutes, {
    prefix: '/api/v1/conversations',
    database: options.database,
    cookieName: options.cookieName,
    realtimeEvents
  });

  return app;
}
