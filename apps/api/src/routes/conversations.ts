import type { FastifyPluginAsync } from 'fastify';
import { and, desc, eq, lt } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '@cubic/database';
import { attachments, blocks, conversationMembers, conversations, directConversationPairs, friendships, messages, users } from '@cubic/database/schema';
import { createRequireAuth } from '../auth/guard.js';
import type { RealtimeEvents, RealtimeMessage } from '../realtime/events.js';

const directBodySchema = z.object({ userId: z.string().uuid() });
const conversationParamsSchema = z.object({ id: z.string().uuid() });
const messageParamsSchema = z.object({
  id: z.string().uuid(),
  messageId: z.string().uuid()
});
const messagesQuerySchema = z.object({ before: z.string().datetime().optional(), limit: z.coerce.number().int().min(1).max(100).default(50) });
const messageBodySchema = z.object({
  clientMessageId: z.string().uuid(),
  body: z.string().trim().max(8000).default(''),
  attachmentIds: z.array(z.string().uuid()).max(10).default([]),
  replyToMessageId: z.string().uuid().nullable().optional()
}).superRefine((value, ctx) => {
  if (!value.body && value.attachmentIds.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Message body or attachment is required.'
    });
  }

  if (new Set(value.attachmentIds).size !== value.attachmentIds.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['attachmentIds'],
      message: 'Attachment IDs must be unique.'
    });
  }
});
const messageEditSchema = z.object({ body: z.string().trim().max(8000) });

function orderedPair(a: string, b: string): [string, string] { return a < b ? [a, b] : [b, a]; }

export interface ConversationRoutesOptions { database: Database; cookieName: string; realtimeEvents?: RealtimeEvents; }

async function isMember(database: Database, conversationId: string, userId: string): Promise<boolean> {
  const rows = await database.db.select({ userId: conversationMembers.userId }).from(conversationMembers)
    .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, userId))).limit(1);
  return Boolean(rows[0]);
}

export type AttachmentDto = {
  id: string;
  conversationId: string;
  messageId: string | null;
  originalName: string;
  contentType: string;
  kind: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  createdAt: string;
  url: string;
};

export type ReplyPreviewDto = {
  id: string;
  senderId: string;
  senderUsername: string;
  senderDisplayName: string;
  body: string;
  deletedAt: string | null;
  attachmentKind: 'image' | 'video' | 'file' | null;
};

function attachmentDto(row: any): AttachmentDto {
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
    createdAt: new Date(row.created_at).toISOString(),
    url: `/api/v1/attachments/${row.id}/content`
  };
}

async function attachmentsForMessages(
  database: Database,
  messageIds: string[]
): Promise<Map<string, AttachmentDto[]>> {
  const byMessage = new Map<string, AttachmentDto[]>();
  if (messageIds.length === 0) return byMessage;

  const result = await database.pool.query(
    `select
       id,
       conversation_id,
       message_id,
       original_name,
       content_type,
       kind,
       size_bytes,
       width,
       height,
       created_at
     from attachments
     where message_id = any($1::uuid[])
     order by created_at asc, id asc`,
    [messageIds]
  );

  for (const row of result.rows) {
    if (!row.message_id) continue;
    const list = byMessage.get(row.message_id) ?? [];
    list.push(attachmentDto(row));
    byMessage.set(row.message_id, list);
  }

  return byMessage;
}

async function replyPreviewsForMessages(
  database: Database,
  replyToMessageIds: Array<string | null | undefined>
): Promise<Map<string, ReplyPreviewDto>> {
  const ids = [...new Set(replyToMessageIds.filter((id): id is string => Boolean(id)))];
  const previews = new Map<string, ReplyPreviewDto>();
  if (ids.length === 0) return previews;

  const result = await database.pool.query(
    `select
       parent.id,
       parent.sender_id,
       parent.body,
       parent.deleted_at,
       sender.username as sender_username,
       sender.display_name as sender_display_name,
       first_attachment.content_type as attachment_content_type
     from messages parent
     join users sender on sender.id = parent.sender_id
     left join lateral (
       select a.content_type
       from attachments a
       where a.message_id = parent.id
       order by a.created_at asc, a.id asc
       limit 1
     ) first_attachment on true
     where parent.id = any($1::uuid[])`,
    [ids]
  );

  for (const row of result.rows) {
    const attachmentKind = row.attachment_content_type?.startsWith('image/')
      ? 'image'
      : row.attachment_content_type?.startsWith('video/')
        ? 'video'
        : row.attachment_content_type
          ? 'file'
          : null;
    previews.set(row.id, {
      id: row.id,
      senderId: row.sender_id,
      senderUsername: row.sender_username,
      senderDisplayName: row.sender_display_name,
      body: row.deleted_at ? '' : row.body.slice(0, 160),
      deletedAt: row.deleted_at ? new Date(row.deleted_at).toISOString() : null,
      attachmentKind: row.deleted_at ? null : attachmentKind
    });
  }

  return previews;
}

type MessageRow = {
  id: string;
  conversationId: string;
  senderId: string;
  clientMessageId: string;
  replyToMessageId: string | null;
  body: string;
  createdAt: Date;
  editedAt: Date | null;
  deletedAt: Date | null;
  senderUsername?: string;
  senderDisplayName?: string;
  senderAvatarUrl?: string | null;
};

function messageDto(
  row: MessageRow,
  attachmentsByMessage: Map<string, AttachmentDto[]>,
  replyPreviews: Map<string, ReplyPreviewDto>
): RealtimeMessage {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    editedAt: row.editedAt?.toISOString() ?? null,
    deletedAt: row.deletedAt?.toISOString() ?? null,
    attachments: attachmentsByMessage.get(row.id) ?? [],
    replyTo: row.replyToMessageId
      ? replyPreviews.get(row.replyToMessageId) ?? null
      : null
  };
}

async function serializeMessages(
  database: Database,
  rows: MessageRow[]
): Promise<RealtimeMessage[]> {
  const [attachmentsByMessage, replyPreviews] = await Promise.all([
    attachmentsForMessages(database, rows.map((row) => row.id)),
    replyPreviewsForMessages(database, rows.map((row) => row.replyToMessageId))
  ]);
  return rows.map((row) => messageDto(row, attachmentsByMessage, replyPreviews));
}

async function fetchMessage(
  database: Database,
  conversationId: string,
  messageId: string
): Promise<MessageRow | null> {
  const result = await database.pool.query(
    `select
       m.id,
       m.conversation_id,
       m.sender_id,
       m.client_message_id,
       m.reply_to_message_id,
       m.body,
       m.created_at,
       m.edited_at,
       m.deleted_at,
       u.username as sender_username,
       u.display_name as sender_display_name,
       u.avatar_url as sender_avatar_url
     from messages m
     join users u on u.id = m.sender_id
     where m.id = $1 and m.conversation_id = $2
     limit 1`,
    [messageId, conversationId]
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    conversationId: row.conversation_id,
    senderId: row.sender_id,
    clientMessageId: row.client_message_id,
    replyToMessageId: row.reply_to_message_id,
    body: row.body,
    createdAt: new Date(row.created_at),
    editedAt: row.edited_at ? new Date(row.edited_at) : null,
    deletedAt: row.deleted_at ? new Date(row.deleted_at) : null,
    senderUsername: row.sender_username,
    senderDisplayName: row.sender_display_name,
    senderAvatarUrl: row.sender_avatar_url
  };
}

export const conversationRoutes: FastifyPluginAsync<ConversationRoutesOptions> = async (app, options) => {
  const requireAuth = createRequireAuth(options.database, options.cookieName);

  app.get('/', { preHandler: requireAuth }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: 'Authentication required.' });
    const result = await options.database.pool.query(
      `select c.id, c.kind, c.title, c.avatar_key, c.created_at, c.updated_at, mine.role as current_role,
              peer.id as peer_id, peer.username as peer_username, peer.display_name as peer_display_name, peer.avatar_url as peer_avatar_url,
              members.member_count,
              lm.id as last_message_id, lm.body as last_message_body, lm.created_at as last_message_at, lm.sender_id as last_message_sender_id
       from conversation_members mine
       join conversations c on c.id = mine.conversation_id
       left join direct_conversation_pairs dp on dp.conversation_id = c.id
       left join users peer on peer.id = case when dp.user_low_id = $1 then dp.user_high_id else dp.user_low_id end
       left join lateral (
         select count(*)::int as member_count from conversation_members cm where cm.conversation_id = c.id
       ) members on true
       left join lateral (
         select m.id, m.body, m.created_at, m.sender_id
         from messages m where m.conversation_id = c.id and m.deleted_at is null
         order by m.created_at desc, m.id desc limit 1
       ) lm on true
       where mine.user_id = $1
       order by coalesce(lm.created_at, c.updated_at) desc`,
      [request.auth.user.id]
    );

    return reply.send({ conversations: result.rows.map((row) => ({
      id: row.id, kind: row.kind, title: row.title, currentRole: row.current_role, memberCount: row.member_count ?? 0,
      avatarUrl: row.kind === 'group' && row.avatar_key ? `/api/v1/groups/${row.id}/avatar?v=${new Date(row.updated_at).getTime()}` : null,
      createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString(),
      peer: row.peer_id ? { id: row.peer_id, username: row.peer_username, displayName: row.peer_display_name, avatarUrl: row.peer_avatar_url } : null,
      lastMessage: row.last_message_id ? { id: row.last_message_id, body: row.last_message_body, createdAt: new Date(row.last_message_at).toISOString(), senderId: row.last_message_sender_id } : null
    })) });
  });

  app.post('/direct', { preHandler: requireAuth }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: 'Authentication required.' });
    const parsed = directBodySchema.safeParse(request.body);
    if (!parsed.success || parsed.data.userId === request.auth.user.id) return reply.code(400).send({ error: 'Invalid user id.' });
    const me = request.auth.user.id;
    const target = parsed.data.userId;
    const [low, high] = orderedPair(me, target);

    const friend = await options.database.db.select({ id: friendships.id }).from(friendships)
      .where(and(eq(friendships.userLowId, low), eq(friendships.userHighId, high))).limit(1);
    if (!friend[0]) return reply.code(403).send({ error: 'Direct conversations are limited to friends in alpha.4.' });

    const blocked = await options.database.db.select({ id: blocks.id }).from(blocks)
      .where(and(eq(blocks.blockerId, me), eq(blocks.blockedId, target))).limit(1);
    const blockedByPeer = await options.database.db.select({ id: blocks.id }).from(blocks)
      .where(and(eq(blocks.blockerId, target), eq(blocks.blockedId, me))).limit(1);
    if (blocked[0] || blockedByPeer[0]) return reply.code(403).send({ error: 'Conversation is not allowed.' });

    const existing = await options.database.db.select({ conversationId: directConversationPairs.conversationId }).from(directConversationPairs)
      .where(and(eq(directConversationPairs.userLowId, low), eq(directConversationPairs.userHighId, high))).limit(1);
    if (existing[0]) {
      options.realtimeEvents?.emitConversationOpened({
        conversationId: existing[0].conversationId,
        userIds: [me, target]
      });
      return reply.send({ conversationId: existing[0].conversationId, created: false });
    }

    const conversationId = await options.database.db.transaction(async (tx) => {
      const [conversation] = await tx.insert(conversations).values({ kind: 'direct', createdBy: me }).returning({ id: conversations.id });
      if (!conversation) throw new Error('Failed to create conversation.');
      await tx.insert(conversationMembers).values([
        { conversationId: conversation.id, userId: me, role: 'member' },
        { conversationId: conversation.id, userId: target, role: 'member' }
      ]);
      await tx.insert(directConversationPairs).values({ conversationId: conversation.id, userLowId: low, userHighId: high });
      return conversation.id;
    });

    options.realtimeEvents?.emitConversationOpened({
      conversationId,
      userIds: [me, target]
    });

    return reply.code(201).send({ conversationId, created: true });
  });

  app.get('/:id/messages', { preHandler: requireAuth }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: 'Authentication required.' });
    const params = conversationParamsSchema.safeParse(request.params);
    const query = messagesQuerySchema.safeParse(request.query);
    if (!params.success || !query.success) return reply.code(400).send({ error: 'Invalid request.' });
    if (!(await isMember(options.database, params.data.id, request.auth.user.id))) return reply.code(404).send({ error: 'Conversation not found.' });

    const conditions = [eq(messages.conversationId, params.data.id)];
    if (query.data.before) conditions.push(lt(messages.createdAt, new Date(query.data.before)));
    const rows = await options.database.db.select({
      id: messages.id, conversationId: messages.conversationId, senderId: messages.senderId, clientMessageId: messages.clientMessageId,
      replyToMessageId: messages.replyToMessageId, body: messages.body, createdAt: messages.createdAt,
      editedAt: messages.editedAt, deletedAt: messages.deletedAt,
      senderUsername: users.username, senderDisplayName: users.displayName, senderAvatarUrl: users.avatarUrl
    }).from(messages).innerJoin(users, eq(messages.senderId, users.id))
      .where(and(...conditions)).orderBy(desc(messages.createdAt), desc(messages.id)).limit(query.data.limit + 1);

    const hasMore = rows.length > query.data.limit;
    const page = rows.slice(0, query.data.limit).reverse();
    const serialized = await serializeMessages(options.database, page);

    return reply.send({
      messages: serialized,
      nextCursor: hasMore && page[0] ? page[0].createdAt.toISOString() : null
    });
  });

  app.post('/:id/messages', { preHandler: requireAuth }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: 'Authentication required.' });
    const params = conversationParamsSchema.safeParse(request.params);
    const parsed = messageBodySchema.safeParse(request.body);
    if (!params.success || !parsed.success) return reply.code(400).send({ error: 'Invalid message.' });
    const me = request.auth.user.id;
    if (!(await isMember(options.database, params.data.id, me))) return reply.code(404).send({ error: 'Conversation not found.' });

    const blocked = await options.database.pool.query(
      `select 1 from direct_conversation_pairs dp
       join blocks b on (b.blocker_id = dp.user_low_id and b.blocked_id = dp.user_high_id) or (b.blocker_id = dp.user_high_id and b.blocked_id = dp.user_low_id)
       where dp.conversation_id = $1 limit 1`, [params.data.id]
    );
    if (blocked.rowCount) return reply.code(403).send({ error: 'Messaging is not allowed.' });

    const existing = await options.database.db.select().from(messages)
      .where(and(eq(messages.senderId, me), eq(messages.clientMessageId, parsed.data.clientMessageId))).limit(1);

    if (existing[0]) {
      const existingMessage = await fetchMessage(
        options.database,
        existing[0].conversationId,
        existing[0].id
      );
      if (!existingMessage) throw new Error('Failed to load existing message.');
      const [serialized] = await serializeMessages(options.database, [existingMessage]);

      return reply.send({
        message: serialized,
        duplicate: true
      });
    }

    if (parsed.data.replyToMessageId) {
      const target = await fetchMessage(
        options.database,
        params.data.id,
        parsed.data.replyToMessageId
      );
      if (!target) {
        return reply.code(400).send({ error: 'Reply target not found in this conversation.' });
      }
    }

    const now = new Date();
    const client = await options.database.pool.connect();

    let created: any;
    let boundAttachmentRows: any[] = [];

    try {
      await client.query('begin');

      const messageResult = await client.query(
        `insert into messages (
           conversation_id,
           sender_id,
           client_message_id,
           reply_to_message_id,
           body,
           created_at
         ) values ($1, $2, $3, $4, $5, $6)
         returning *`,
        [
          params.data.id,
          me,
          parsed.data.clientMessageId,
          parsed.data.replyToMessageId ?? null,
          parsed.data.body,
          now
        ]
      );

      created = messageResult.rows[0];
      if (!created) throw new Error('Failed to persist message.');

      if (parsed.data.attachmentIds.length > 0) {
        const attachmentResult = await client.query(
          `update attachments
              set message_id = $1,
                  attached_at = $2
            where id = any($3::uuid[])
              and conversation_id = $4
              and uploader_id = $5
              and message_id is null
          returning
              id,
              conversation_id,
              message_id,
              original_name,
              content_type,
              kind,
              size_bytes,
              width,
              height,
              created_at`,
          [
            created.id,
            now,
            parsed.data.attachmentIds,
            params.data.id,
            me
          ]
        );

        if (attachmentResult.rowCount !== parsed.data.attachmentIds.length) {
          const error = new Error('One or more attachments are not available.');
          (error as NodeJS.ErrnoException).code = 'CUBIC_ATTACHMENT_BIND';
          throw error;
        }

        boundAttachmentRows = attachmentResult.rows;
      }

      await client.query(
        `update conversations
            set updated_at = $1
          where id = $2`,
        [now, params.data.id]
      );

      await client.query('commit');
    } catch (error) {
      await client.query('rollback').catch(() => {});

      if ((error as NodeJS.ErrnoException).code === 'CUBIC_ATTACHMENT_BIND') {
        return reply.code(400).send({
          error: 'One or more attachments are no longer available.'
        });
      }

      throw error;
    } finally {
      client.release();
    }

    const createdRow: MessageRow = {
      id: created.id,
      conversationId: created.conversation_id,
      senderId: created.sender_id,
      clientMessageId: created.client_message_id,
      replyToMessageId: created.reply_to_message_id,
      body: created.body,
      createdAt: new Date(created.created_at),
      editedAt: created.edited_at ? new Date(created.edited_at) : null,
      deletedAt: created.deleted_at ? new Date(created.deleted_at) : null,
      senderUsername: request.auth.user.username,
      senderDisplayName: request.auth.user.displayName,
      senderAvatarUrl: request.auth.user.avatarUrl
    };
    const replyPreviews = await replyPreviewsForMessages(
      options.database,
      [createdRow.replyToMessageId]
    );
    const message = messageDto(
      createdRow,
      new Map([[createdRow.id, boundAttachmentRows.map(attachmentDto)]]),
      replyPreviews
    );

    options.realtimeEvents?.emitMessageCreated({
      conversationId: params.data.id,
      message
    });

    return reply.code(201).send({ message, duplicate: false });
  });

  app.patch('/:id/messages/:messageId', { preHandler: requireAuth }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: 'Authentication required.' });
    const params = messageParamsSchema.safeParse(request.params);
    const parsed = messageEditSchema.safeParse(request.body);
    if (!params.success || !parsed.success) return reply.code(400).send({ error: 'Invalid message.' });

    const me = request.auth.user.id;
    if (!(await isMember(options.database, params.data.id, me))) {
      return reply.code(404).send({ error: 'Conversation not found.' });
    }

    const current = await fetchMessage(options.database, params.data.id, params.data.messageId);
    if (!current) return reply.code(404).send({ error: 'Message not found.' });
    if (current.senderId !== me) return reply.code(403).send({ error: 'You can only edit your own messages.' });
    if (current.deletedAt) return reply.code(409).send({ error: 'Deleted messages cannot be edited.' });

    if (!parsed.data.body) {
      const attachment = await options.database.pool.query(
        'select 1 from attachments where message_id = $1 limit 1',
        [current.id]
      );
      if (!attachment.rowCount) {
        return reply.code(400).send({ error: 'Message body is required.' });
      }
    }

    const updatedAt = new Date();
    const updated = await options.database.pool.query(
      `update messages
          set body = $1, edited_at = $2
        where id = $3
          and conversation_id = $4
          and sender_id = $5
          and deleted_at is null
      returning id`,
      [parsed.data.body, updatedAt, current.id, params.data.id, me]
    );
    if (!updated.rowCount) return reply.code(409).send({ error: 'Message can no longer be edited.' });

    const changed = await fetchMessage(options.database, params.data.id, current.id);
    if (!changed) throw new Error('Failed to load edited message.');
    const [message] = await serializeMessages(options.database, [changed]);
    if (!message) throw new Error('Failed to serialize edited message.');

    options.realtimeEvents?.emitMessageUpdated({ conversationId: params.data.id, message });
    return reply.send({ message });
  });

  app.delete('/:id/messages/:messageId', { preHandler: requireAuth }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: 'Authentication required.' });
    const params = messageParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'Invalid message.' });

    const me = request.auth.user.id;
    if (!(await isMember(options.database, params.data.id, me))) {
      return reply.code(404).send({ error: 'Conversation not found.' });
    }

    const current = await fetchMessage(options.database, params.data.id, params.data.messageId);
    if (!current) return reply.code(404).send({ error: 'Message not found.' });
    if (current.senderId !== me) return reply.code(403).send({ error: 'You can only delete your own messages.' });
    if (current.deletedAt) return reply.code(409).send({ error: 'Message is already deleted.' });

    const deletedAt = new Date();
    const deleted = await options.database.pool.query(
      `update messages
          set body = '', deleted_at = $1
        where id = $2
          and conversation_id = $3
          and sender_id = $4
          and deleted_at is null
      returning id`,
      [deletedAt, current.id, params.data.id, me]
    );
    if (!deleted.rowCount) return reply.code(409).send({ error: 'Message is already deleted.' });

    const changed = await fetchMessage(options.database, params.data.id, current.id);
    if (!changed) throw new Error('Failed to load deleted message.');
    const [message] = await serializeMessages(options.database, [changed]);
    if (!message) throw new Error('Failed to serialize deleted message.');

    options.realtimeEvents?.emitMessageDeleted({ conversationId: params.data.id, message });
    return reply.send({ message });
  });
};
