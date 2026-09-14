import type { FastifyPluginAsync, preHandlerAsyncHookHandler } from 'fastify';
import { z } from 'zod';
import type { Database } from '@cubic/database';
import { createRequireAuth } from '../auth/guard.js';
import type { SessionService } from '../security/session.js';
import {
  AttachmentStorageReserveError,
  attachmentDeliveryPolicy,
  safeAttachmentContentDisposition,
  type AttachmentStore
} from '../media/attachments.js';
import {
  PendingAttachmentQuotaError,
  type insertPendingAttachmentWithinQuota
} from '../media/attachment-quotas.js';

const conversationParamsSchema = z.object({
  id: z.string().uuid()
});

const attachmentParamsSchema = z.object({
  id: z.string().uuid()
});

export interface AttachmentRoutesOptions {
  database: Database;
  cookieName: string;
  sessionService: SessionService;
  attachmentStore: AttachmentStore;
  attachmentMaxBytes: number;
  attachmentPendingMaxCount: number;
  attachmentPendingMaxBytes: number;
  attachmentMinFreeBytes: number;
  uploadRateLimit?: preHandlerAsyncHookHandler;
  insertPendingAttachment: typeof insertPendingAttachmentWithinQuota;
}

async function isMember(
  database: Database,
  conversationId: string,
  userId: string
): Promise<boolean> {
  const result = await database.pool.query(
    `select 1
       from conversation_members
      where conversation_id = $1
        and user_id = $2
      limit 1`,
    [conversationId, userId]
  );

  return Boolean(result.rowCount);
}

async function messagingBlocked(
  database: Database,
  conversationId: string
): Promise<boolean> {
  const result = await database.pool.query(
    `select 1
       from direct_conversation_pairs dp
       join blocks b
         on (
           b.blocker_id = dp.user_low_id
           and b.blocked_id = dp.user_high_id
         )
         or (
           b.blocker_id = dp.user_high_id
           and b.blocked_id = dp.user_low_id
         )
      where dp.conversation_id = $1
      limit 1`,
    [conversationId]
  );

  return Boolean(result.rowCount);
}

function dto(row: any) {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    messageId: row.message_id,
    originalName: row.original_name,
    contentType: row.content_type,
    kind: row.kind,
    sizeBytes: row.size_bytes,
    width: row.width,
    height: row.height,
    createdAt: new Date(row.created_at).toISOString()
  };
}

export const attachmentRoutes: FastifyPluginAsync<AttachmentRoutesOptions> =
  async (app, options) => {
    const requireAuth = createRequireAuth(options.sessionService, options.cookieName);

    const uploadPreHandlers = options.uploadRateLimit
      ? [requireAuth, options.uploadRateLimit]
      : [requireAuth];

    app.post(
      '/conversations/:id/attachments',
      {
        config: { rateLimit: false },
        preHandler: uploadPreHandlers
      },
      async (request, reply) => {
        if (!request.auth) {
          return reply.code(401).send({ error: 'Authentication required.' });
        }

        const params = conversationParamsSchema.safeParse(request.params);
        if (!params.success) {
          return reply.code(400).send({ error: 'Invalid conversation.' });
        }

        const conversationId = params.data.id;
        const me = request.auth.user.id;

        if (!(await isMember(options.database, conversationId, me))) {
          return reply.code(404).send({ error: 'Conversation not found.' });
        }

        if (await messagingBlocked(options.database, conversationId)) {
          return reply.code(403).send({ error: 'Messaging is not allowed.' });
        }

        try {
          await options.attachmentStore.assertFreeSpace(
            options.attachmentMaxBytes,
            options.attachmentMinFreeBytes
          );
        } catch (error) {
          if (error instanceof AttachmentStorageReserveError) {
            request.log.warn(
              {
                availableBytes: error.availableBytes.toString(),
                requiredBytes: error.requiredBytes.toString(),
                reserveBytes: error.reserveBytes.toString()
              },
              'Attachment upload rejected to preserve the media storage reserve'
            );
            return reply.code(507).send({
              code: 'ATTACHMENT_STORAGE_RESERVE',
              error: 'Attachment storage is temporarily full.'
            });
          }

          request.log.error(
            { errorCode: (error as NodeJS.ErrnoException).code ?? 'UNKNOWN' },
            'Could not inspect available attachment storage'
          );
          return reply.code(503).send({
            error: 'Attachment storage is temporarily unavailable.'
          });
        }

        const part = await request.file().catch(() => null);
        if (!part) {
          return reply.code(400).send({ error: 'Choose a file to upload.' });
        }

        let stored;
        try {
          stored = await options.attachmentStore.save(part.file, {
            originalName: part.filename,
            claimedMime: part.mimetype || 'application/octet-stream',
            maxBytes: options.attachmentMaxBytes
          });
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (
            code === 'CUBIC_ATTACHMENT_TOO_LARGE' ||
            part.file.truncated
          ) {
            return reply.code(413).send({
              error:
                `Attachment exceeds the ` +
                `${Math.floor(options.attachmentMaxBytes / 1024 / 1024)} MB limit.`
            });
          }

          return reply.code(400).send({
            error: 'Could not store attachment.'
          });
        }

        if (part.file.truncated || stored.sizeBytes > options.attachmentMaxBytes) {
          await options.attachmentStore.discardStaged(stored.key).catch(() => {});
          return reply.code(413).send({
            error:
              `Attachment exceeds the ` +
              `${Math.floor(options.attachmentMaxBytes / 1024 / 1024)} MB limit.`
          });
        }

        let published = false;
        try {
          const row = await options.insertPendingAttachment(
            options.database,
            {
              conversationId,
              uploaderId: me,
              ...stored
            },
            {
              maxCount: options.attachmentPendingMaxCount,
              maxBytes: options.attachmentPendingMaxBytes
            },
            async () => {
              await options.attachmentStore.publish(stored.key);
              published = true;
            }
          );

          return reply.code(201).send({
            attachment: dto(row)
          });
        } catch (error) {
          if (!published) {
            await options.attachmentStore.discardStaged(stored.key).catch(() => {});
          } else {
            request.log.warn(
              { errorCode: (error as NodeJS.ErrnoException).code ?? 'UNKNOWN' },
              'Attachment metadata transaction failed after file publication; reconciliation will recover the orphan'
            );
          }

          if (error instanceof PendingAttachmentQuotaError) {
            const countQuota = error.reason === 'count';
            return reply.code(409).send({
              code: countQuota
                ? 'ATTACHMENT_PENDING_COUNT_QUOTA'
                : 'ATTACHMENT_PENDING_BYTE_QUOTA',
              error: countQuota
                ? 'Pending attachment count limit reached. Send or remove pending attachments before uploading more.'
                : 'Pending attachment storage limit reached. Send or remove pending attachments before uploading more.'
            });
          }

          throw error;
        }
      }
    );


    app.get(
      '/attachments/:id/content',
      { preHandler: requireAuth },
      async (request, reply) => {
        if (!request.auth) {
          return reply.code(401).send({ error: 'Authentication required.' });
        }

        const params = attachmentParamsSchema.safeParse(request.params);
        if (!params.success) {
          return reply.code(400).send({ error: 'Invalid attachment.' });
        }

        const result = await options.database.pool.query(
          `select
             a.id,
             a.conversation_id,
             a.uploader_id,
             a.message_id,
             a.storage_key,
             a.original_name,
             a.content_type,
             a.size_bytes
           from attachments a
          where a.id = $1
            and (
              (
                a.message_id is null
                and a.uploader_id = $2
              )
              or (
                a.message_id is not null
                and exists (
                  select 1
                    from conversation_members cm
                   where cm.conversation_id = a.conversation_id
                     and cm.user_id = $2
                )
              )
            )
          limit 1`,
          [params.data.id, request.auth.user.id]
        );

        const row = result.rows[0];
        if (!row) {
          return reply.code(404).send({ error: 'Attachment not found.' });
        }

        let content;
        let detectedContentType: string;
        try {
          detectedContentType = await options.attachmentStore.detectForDelivery(
            row.storage_key,
            row.content_type
          );
          content = await options.attachmentStore.open(row.storage_key);
        } catch (error) {
          request.log.warn(
            {
              attachmentId: row.id,
              errorCode: (error as NodeJS.ErrnoException).code ?? 'UNKNOWN'
            },
            'Attachment metadata references unavailable storage bytes'
          );
          return reply.code(404).send({ error: 'Attachment not found.' });
        }

        const delivery = attachmentDeliveryPolicy(detectedContentType);

        reply.header('Content-Type', delivery.contentType);
        reply.header('Content-Length', String(row.size_bytes));
        reply.header('X-Content-Type-Options', 'nosniff');
        reply.header('Cache-Control', 'private, no-store');
        reply.header(
          'Content-Disposition',
          safeAttachmentContentDisposition(row.original_name, delivery.disposition)
        );

        return reply.send(content);
      }
    );

    app.delete(
      '/attachments/:id',
      { preHandler: requireAuth },
      async (request, reply) => {
        if (!request.auth) {
          return reply.code(401).send({ error: 'Authentication required.' });
        }

        const params = attachmentParamsSchema.safeParse(request.params);
        if (!params.success) {
          return reply.code(400).send({ error: 'Invalid attachment.' });
        }

        const result = await options.database.pool.query(
          `delete from attachments
            where id = $1
              and uploader_id = $2
              and message_id is null
          returning id`,
          [params.data.id, request.auth.user.id]
        );

        if (!result.rowCount) {
          return reply.code(404).send({ error: 'Attachment not found.' });
        }

        return reply.code(204).send();
      }
    );
  };
