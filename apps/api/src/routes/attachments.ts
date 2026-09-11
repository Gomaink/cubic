import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { Database } from '@cubic/database';
import { createRequireAuth } from '../auth/guard.js';
import type { AttachmentStore } from '../media/attachments.js';

const conversationParamsSchema = z.object({
  id: z.string().uuid()
});

const attachmentParamsSchema = z.object({
  id: z.string().uuid()
});

export interface AttachmentRoutesOptions {
  database: Database;
  cookieName: string;
  attachmentStore: AttachmentStore;
  attachmentMaxBytes: number;
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

async function cleanupStalePending(
  database: Database,
  attachmentStore: AttachmentStore
): Promise<void> {
  const result = await database.pool.query(
    `select id, storage_key
       from attachments
      where message_id is null
        and created_at < now() - interval '24 hours'
      order by created_at asc
      limit 250`
  );

  for (const row of result.rows) {
    try {
      await attachmentStore.delete(row.storage_key);
      await database.pool.query(
        `delete from attachments
          where id = $1
            and message_id is null`,
        [row.id]
      );
    } catch {
      // Retry lazily on a later upload.
    }
  }
}

export const attachmentRoutes: FastifyPluginAsync<AttachmentRoutesOptions> =
  async (app, options) => {
    const requireAuth = createRequireAuth(
      options.database,
      options.cookieName
    );

    let cleanupScheduled = false;

    app.post(
      '/conversations/:id/attachments',
      { preHandler: requireAuth },
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

        if (!cleanupScheduled) {
          cleanupScheduled = true;
          void cleanupStalePending(
            options.database,
            options.attachmentStore
          ).catch(() => {});
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
          await options.attachmentStore.delete(stored.key).catch(() => {});
          return reply.code(413).send({
            error:
              `Attachment exceeds the ` +
              `${Math.floor(options.attachmentMaxBytes / 1024 / 1024)} MB limit.`
          });
        }

        try {
          const result = await options.database.pool.query(
            `insert into attachments (
               conversation_id,
               uploader_id,
               storage_key,
               original_name,
               content_type,
               kind,
               size_bytes,
               width,
               height
             ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
             returning *`,
            [
              conversationId,
              me,
              stored.key,
              stored.originalName,
              stored.contentType,
              stored.kind,
              stored.sizeBytes,
              stored.width,
              stored.height
            ]
          );

          return reply.code(201).send({
            attachment: dto(result.rows[0])
          });
        } catch (error) {
          await options.attachmentStore.delete(stored.key).catch(() => {});
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
              or exists (
                select 1
                  from conversation_members cm
                 where cm.conversation_id = a.conversation_id
                   and cm.user_id = $2
              )
            )
          limit 1`,
          [params.data.id, request.auth.user.id]
        );

        const row = result.rows[0];
        if (!row) {
          return reply.code(404).send({ error: 'Attachment not found.' });
        }

        const safeInline =
          row.content_type.startsWith('image/') ||
          row.content_type.startsWith('audio/') ||
          row.content_type.startsWith('video/') ||
          row.content_type === 'application/pdf' ||
          row.content_type.startsWith('text/');

        const encodedName = encodeURIComponent(row.original_name);

        reply.header('Content-Type', row.content_type);
        reply.header('Content-Length', String(row.size_bytes));
        reply.header('X-Content-Type-Options', 'nosniff');
        reply.header(
          'Content-Disposition',
          `${safeInline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodedName}`
        );

        return reply.send(options.attachmentStore.open(row.storage_key));
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
          `select id, storage_key
             from attachments
            where id = $1
              and uploader_id = $2
              and message_id is null
            limit 1`,
          [params.data.id, request.auth.user.id]
        );

        const row = result.rows[0];
        if (!row) {
          return reply.code(404).send({ error: 'Attachment not found.' });
        }

        await options.attachmentStore.delete(row.storage_key);

        await options.database.pool.query(
          `delete from attachments
            where id = $1
              and message_id is null`,
          [params.data.id]
        );

        return reply.code(204).send();
      }
    );
  };
