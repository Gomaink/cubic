import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import type { Database } from '@cubic/database';
import { CUBIC_VERSION } from '@cubic/shared';
import { authRoutes } from './routes/auth.js';
import { healthRoutes } from './routes/health.js';
import { userRoutes } from './routes/users.js';
import { socialRoutes } from './routes/social.js';
import { conversationRoutes } from './routes/conversations.js';
import { groupRoutes } from './routes/groups.js';
import { voiceRoutes } from './routes/voice.js';
import { callHistoryRoutes } from './routes/call-history.js';
import { attachmentRoutes } from './routes/attachments.js';
import { createRealtimeEvents, type RealtimeEvents } from './realtime/events.js';
import { LocalMediaStore } from './media/local.js';
import { AttachmentStore } from './media/attachments.js';
import { insertPendingAttachmentWithinQuota } from './media/attachment-quotas.js';
import {
  AttachmentCleanupScheduler,
  cleanupStalePendingBatch
} from './media/attachment-cleanup.js';
import {
  AttachmentDeletionScheduler,
  runAttachmentDeletionBatch
} from './media/attachment-deletions.js';
import {
  AttachmentReconciler,
  AttachmentReconciliationScheduler
} from './media/attachment-reconciliation.js';
import { ATTACHMENT_DEFAULTS } from './config/env.js';
import type { SessionService } from './security/session.js';

export interface CreateAppOptions {
  database: Database;
  corsOrigin: string;
  trustedProxyCidrs: string[];
  cookieName: string;
  cookieSecure: boolean;
  sessionTtlDays: number;
  sessionService: SessionService;
  registrationEnabled: boolean;
  mediaRoot?: string;
  groupAvatarMaxBytes?: number;
  attachmentMaxBytes?: number;
  attachmentPendingMaxCount?: number;
  attachmentPendingMaxBytes?: number;
  attachmentMinFreeBytes?: number;
  attachmentUploadRateLimitMax?: number;
  attachmentUploadRateLimitWindowMs?: number;
  attachmentCleanupIntervalMs?: number;
  attachmentStaleAgeMs?: number;
  attachmentCleanupBatchSize?: number;
  attachmentDeletionIntervalMs?: number;
  attachmentDeletionBatchSize?: number;
  attachmentDeletionLeaseMs?: number;
  attachmentDeletionRetryBaseMs?: number;
  attachmentDeletionRetryMaxMs?: number;
  attachmentReconciliationIntervalMs?: number;
  attachmentOrphanGraceMs?: number;
  attachmentReconciliationScanBatchSize?: number;
  attachmentReconciliationMissingBatchSize?: number;
  livekitPublicUrl: string;
  livekitApiKey: string;
  livekitApiSecret: string;
  logger?: boolean;
  realtimeEvents?: RealtimeEvents;
}

export async function createApp(options: CreateAppOptions): Promise<FastifyInstance> {
  const realtimeEvents = options.realtimeEvents ?? createRealtimeEvents();
  const app = Fastify({
    logger: options.logger ?? true,
    trustProxy: options.trustedProxyCidrs,
    bodyLimit: Math.max(
      2 * 1024 * 1024,
      (options.groupAvatarMaxBytes ?? 2 * 1024 * 1024) + 512 * 1024,
      (options.attachmentMaxBytes ?? ATTACHMENT_DEFAULTS.maxBytes) + 1024 * 1024
    )
  });

  await app.register(cookie);
  await app.register(multipart, {
    limits: {
      files: 1,
      fileSize: Math.max(
        options.groupAvatarMaxBytes ?? 2 * 1024 * 1024,
        options.attachmentMaxBytes ?? ATTACHMENT_DEFAULTS.maxBytes
      )
    }
  });

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
    sessionService: options.sessionService,
    realtimeEvents,
    registrationEnabled: options.registrationEnabled
  });

  await app.register(userRoutes, {
    prefix: '/api/v1/users',
    database: options.database,
    cookieName: options.cookieName,
    sessionService: options.sessionService
  });

  await app.register(socialRoutes, {
    prefix: '/api/v1/social',
    database: options.database,
    cookieName: options.cookieName,
    sessionService: options.sessionService
  });

  await app.register(conversationRoutes, {
    prefix: '/api/v1/conversations',
    database: options.database,
    cookieName: options.cookieName,
    sessionService: options.sessionService,
    realtimeEvents
  });

  const attachmentStore = new AttachmentStore(options.mediaRoot ?? '/data/media');
  await attachmentStore.prepare();

  const attachmentUploadRateLimit = app.rateLimit({
    max: options.attachmentUploadRateLimitMax ?? ATTACHMENT_DEFAULTS.uploadRateLimitMax,
    timeWindow:
      options.attachmentUploadRateLimitWindowMs ??
      ATTACHMENT_DEFAULTS.uploadRateLimitWindowMs,
    groupId: 'attachment-upload',
    keyGenerator: (request) => request.auth?.user.id ?? `unauthenticated:${request.ip}`
  });

  await app.register(attachmentRoutes, {
    prefix: '/api/v1',
    database: options.database,
    cookieName: options.cookieName,
    sessionService: options.sessionService,
    attachmentStore,
    attachmentMaxBytes: options.attachmentMaxBytes ?? ATTACHMENT_DEFAULTS.maxBytes,
    attachmentPendingMaxCount:
      options.attachmentPendingMaxCount ?? ATTACHMENT_DEFAULTS.pendingMaxCount,
    attachmentPendingMaxBytes:
      options.attachmentPendingMaxBytes ?? ATTACHMENT_DEFAULTS.pendingMaxBytes,
    attachmentMinFreeBytes:
      options.attachmentMinFreeBytes ?? ATTACHMENT_DEFAULTS.minFreeBytes,
    uploadRateLimit: attachmentUploadRateLimit,
    insertPendingAttachment: insertPendingAttachmentWithinQuota
  });

  const attachmentCleanupScheduler = new AttachmentCleanupScheduler({
    intervalMs:
      options.attachmentCleanupIntervalMs ?? ATTACHMENT_DEFAULTS.cleanupIntervalMs,
    logger: app.log,
    cleanup: () => cleanupStalePendingBatch({
      database: options.database,
      staleAgeMs: options.attachmentStaleAgeMs ?? ATTACHMENT_DEFAULTS.staleAgeMs,
      batchSize:
        options.attachmentCleanupBatchSize ?? ATTACHMENT_DEFAULTS.cleanupBatchSize,
      logger: app.log
    })
  });
  app.addHook('onReady', async () => attachmentCleanupScheduler.start());
  app.addHook('onClose', async () => attachmentCleanupScheduler.stop());

  const attachmentDeletionScheduler = new AttachmentDeletionScheduler({
    intervalMs:
      options.attachmentDeletionIntervalMs ?? ATTACHMENT_DEFAULTS.deletionIntervalMs,
    logger: app.log,
    run: () => runAttachmentDeletionBatch({
      database: options.database,
      attachmentStore,
      batchSize:
        options.attachmentDeletionBatchSize ?? ATTACHMENT_DEFAULTS.deletionBatchSize,
      leaseMs: options.attachmentDeletionLeaseMs ?? ATTACHMENT_DEFAULTS.deletionLeaseMs,
      baseBackoffMs:
        options.attachmentDeletionRetryBaseMs ?? ATTACHMENT_DEFAULTS.deletionRetryBaseMs,
      maximumBackoffMs:
        options.attachmentDeletionRetryMaxMs ?? ATTACHMENT_DEFAULTS.deletionRetryMaxMs,
      logger: app.log
    })
  });
  app.addHook('onReady', async () => attachmentDeletionScheduler.start());
  app.addHook('onClose', async () => attachmentDeletionScheduler.stop());

  const attachmentReconciler = new AttachmentReconciler({
    database: options.database,
    attachmentStore,
    gracePeriodMs:
      options.attachmentOrphanGraceMs ?? ATTACHMENT_DEFAULTS.orphanGraceMs,
    scanBatchSize:
      options.attachmentReconciliationScanBatchSize ??
      ATTACHMENT_DEFAULTS.reconciliationScanBatchSize,
    missingBatchSize:
      options.attachmentReconciliationMissingBatchSize ??
      ATTACHMENT_DEFAULTS.reconciliationMissingBatchSize,
    logger: app.log
  });
  const attachmentReconciliationScheduler = new AttachmentReconciliationScheduler({
    intervalMs:
      options.attachmentReconciliationIntervalMs ??
      ATTACHMENT_DEFAULTS.reconciliationIntervalMs,
    reconciler: attachmentReconciler,
    logger: app.log
  });
  app.addHook('onReady', async () => attachmentReconciliationScheduler.start());
  app.addHook('onClose', async () => attachmentReconciliationScheduler.stop());

  const mediaStore = new LocalMediaStore(options.mediaRoot ?? '/data/media');

  await app.register(groupRoutes, {
    prefix: '/api/v1/groups',
    database: options.database,
    cookieName: options.cookieName,
    sessionService: options.sessionService,
    realtimeEvents,
    mediaStore,
    groupAvatarMaxBytes: options.groupAvatarMaxBytes ?? 2 * 1024 * 1024
  });

  await app.register(voiceRoutes, {
    prefix: '/api/v1/voice',
    database: options.database,
    cookieName: options.cookieName,
    sessionService: options.sessionService,
    livekitPublicUrl: options.livekitPublicUrl,
    livekitApiKey: options.livekitApiKey,
    livekitApiSecret: options.livekitApiSecret
  });

  await app.register(callHistoryRoutes, {
    prefix: '/api/v1/calls',
    database: options.database,
    cookieName: options.cookieName,
    sessionService: options.sessionService
  });

  return app;
}
