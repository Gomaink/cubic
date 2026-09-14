import { createDatabase } from '@cubic/database';
import { createApp } from './app.js';
import { loadEnv } from './config/env.js';
import { createRealtimeEvents } from './realtime/events.js';
import { attachRealtime } from './realtime/socket.js';
import { createSessionService } from './security/session.js';
import {
  LiveKitAuthorizationService,
  createDatabaseVoiceAuthorizationStore
} from './voice/authorization.js';

const env = loadEnv();
const database = createDatabase(env.DATABASE_URL);
const realtimeEvents = createRealtimeEvents();
const sessionService = createSessionService(database, env.SESSION_IDLE_TIMEOUT_MS);
const livekitAuthorization = new LiveKitAuthorizationService({
  apiKey: env.LIVEKIT_API_KEY,
  apiSecret: env.LIVEKIT_API_SECRET,
  apiUrl: env.LIVEKIT_API_URL,
  publicUrl: env.LIVEKIT_PUBLIC_URL,
  sessionService,
  store: createDatabaseVoiceAuthorizationStore(database),
  events: realtimeEvents,
  reconciliationIntervalMs: env.LIVEKIT_AUTHORIZATION_RECONCILE_MS
});
const app = await createApp({
  database,
  corsOrigin: env.CORS_ORIGIN,
  trustedProxyCidrs: env.TRUST_PROXY_CIDRS,
  cookieName: env.SESSION_COOKIE_NAME,
  cookieSecure: env.SESSION_COOKIE_SECURE,
  sessionTtlDays: env.SESSION_TTL_DAYS,
  sessionService,
  registrationEnabled: env.REGISTRATION_ENABLED,
  mediaRoot: env.MEDIA_ROOT,
  groupAvatarMaxBytes: env.GROUP_AVATAR_MAX_BYTES,
  attachmentMaxBytes: env.ATTACHMENT_MAX_BYTES,
  attachmentPendingMaxCount: env.ATTACHMENT_PENDING_MAX_COUNT,
  attachmentPendingMaxBytes: env.ATTACHMENT_PENDING_MAX_BYTES,
  attachmentMinFreeBytes: env.ATTACHMENT_MIN_FREE_BYTES,
  attachmentUploadRateLimitMax: env.ATTACHMENT_UPLOAD_RATE_LIMIT_MAX,
  attachmentUploadRateLimitWindowMs: env.ATTACHMENT_UPLOAD_RATE_LIMIT_WINDOW_MS,
  attachmentCleanupIntervalMs: env.ATTACHMENT_CLEANUP_INTERVAL_MS,
  attachmentStaleAgeMs: env.ATTACHMENT_STALE_AGE_MS,
  attachmentCleanupBatchSize: env.ATTACHMENT_CLEANUP_BATCH_SIZE,
  attachmentDeletionIntervalMs: env.ATTACHMENT_DELETION_INTERVAL_MS,
  attachmentDeletionBatchSize: env.ATTACHMENT_DELETION_BATCH_SIZE,
  attachmentDeletionLeaseMs: env.ATTACHMENT_DELETION_LEASE_MS,
  attachmentDeletionRetryBaseMs: env.ATTACHMENT_DELETION_RETRY_BASE_MS,
  attachmentDeletionRetryMaxMs: env.ATTACHMENT_DELETION_RETRY_MAX_MS,
  attachmentReconciliationIntervalMs: env.ATTACHMENT_RECONCILIATION_INTERVAL_MS,
  attachmentOrphanGraceMs: env.ATTACHMENT_ORPHAN_GRACE_MS,
  attachmentReconciliationScanBatchSize:
    env.ATTACHMENT_RECONCILIATION_SCAN_BATCH_SIZE,
  attachmentReconciliationMissingBatchSize:
    env.ATTACHMENT_RECONCILIATION_MISSING_BATCH_SIZE,
  livekitAuthorization,
  livekitPublicUrl: env.LIVEKIT_PUBLIC_URL,
  realtimeEvents,
  logger: env.NODE_ENV !== 'test'
});

const realtime = attachRealtime({
  server: app.server,
  database,
  cookieName: env.SESSION_COOKIE_NAME,
  sessionService,
  revalidateIntervalMs: env.SESSION_SOCKET_REVALIDATE_MS,
  trustedProxyCidrs: env.TRUST_PROXY_CIDRS,
  browserOrigin: env.CORS_ORIGIN,
  events: realtimeEvents
});

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, 'Shutting down Cubic API');

  try {
    await realtime.close();
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
