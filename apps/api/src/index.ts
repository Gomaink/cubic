import { createDatabase } from '@cubic/database';
import { createApp } from './app.js';
import { loadEnv } from './config/env.js';

const env = loadEnv();
const database = createDatabase(env.DATABASE_URL);
const app = await createApp({
  database,
  corsOrigin: env.CORS_ORIGIN,
  trustProxyHops: env.TRUST_PROXY_HOPS,
  cookieName: env.SESSION_COOKIE_NAME,
  cookieSecure: env.SESSION_COOKIE_SECURE,
  sessionTtlDays: env.SESSION_TTL_DAYS,
  registrationEnabled: env.REGISTRATION_ENABLED,
  logger: env.NODE_ENV !== 'test'
});

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, 'Shutting down Cubic API');

  try {
    await app.close();
    await database.pool.end();
    process.exit(0);
  } catch (error) {
    app.log.error(error, 'Graceful shutdown failed');
    process.exit(1);
  }
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

try {
  await app.listen({ host: env.API_HOST, port: env.API_PORT });
} catch (error) {
  app.log.error(error);
  await database.pool.end();
  process.exit(1);
}
