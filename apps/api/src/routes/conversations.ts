import type { FastifyPluginAsync } from 'fastify';
import { and, desc, eq, lt } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '@cubic/database';
import { attachments, blocks, conversationMembers, conversations, directConversationPairs, friendships, messages, users } from '@cubic/database/schema';
import { createRequireAuth } from '../auth/guard.js';
import type { RealtimeEvents, RealtimeMessage } from '../realtime/events.js';

const directBodySchema = z.object({ userId: z.string().uuid() });
const conversationParamsSchema = z.object({ id: z.string().uuid() });
const messagesQuerySchema = z.object({ before: z.string().datetime().optional(), limit: z.coerce.number().int().min(1).max(100).default(50) });
const messageBodySchema = z.object({
  clientMessageId: z.string().uuid(),
  body: z.string().trim().max(8000).default(''),
  attachmentIds: z.array(z.string().uuid()).max(10).default([])
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

function orderedPair(a: string, b: string): [string, string] { return a < b ? [a, b] : [b, a]; }

export interface ConversationRoutesOptions { database: Database; cookieName: string; realtimeEvents?: RealtimeEvents; }

async function isMember(database: Database, conversationId: string, userId: string): Promise<boolean> {
  const rows = await database.db.select({ userId: conversationMembers.userId }).from(conversationMembers)
    .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, userId))).limit(1);
  return Boolean(rows[0]);
}

type AttachmentDto = {
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
      body: messages.body, createdAt: messages.createdAt, editedAt: messages.editedAt, deletedAt: messages.deletedAt,
      senderUsername: users.username, senderDisplayName: users.displayName, senderAvatarUrl: users.avatarUrl
    }).from(messages).innerJoin(users, eq(messages.senderId, users.id))
      .where(and(...conditions)).orderBy(desc(messages.createdAt), desc(messages.id)).limit(query.data.limit + 1);

    const hasMore = rows.length > query.data.limit;
    const page = rows.slice(0, query.data.limit).reverse();
    const attachmentsByMessage = await attachmentsForMessages(
      options.database,
      page.map((row) => row.id)
    );

    return reply.send({
      messages: page.map((row) => ({
        ...row,
        createdAt: row.createdAt.toISOString(),
        editedAt: row.editedAt?.toISOString() ?? null,
        deletedAt: row.deletedAt?.toISOString() ?? null,
        attachments: attachmentsByMessage.get(row.id) ?? []
      })),
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
      const attachmentsByMessage = await attachmentsForMessages(
        options.database,
        [existing[0].id]
      );

      return reply.send({
        message: {
          ...existing[0],
          createdAt: existing[0].createdAt.toISOString(),
          editedAt: existing[0].editedAt?.toISOString() ?? null,
          deletedAt: existing[0].deletedAt?.toISOString() ?? null,
          attachments: attachmentsByMessage.get(existing[0].id) ?? []
        },
        duplicate: true
      });
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
           body,
           created_at
         ) values ($1, $2, $3, $4, $5)
         returning *`,
        [
          params.data.id,
          me,
          parsed.data.clientMessageId,
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

    const message = {
      id: created.id,
      conversationId: created.conversation_id,
      senderId: created.sender_id,
      clientMessageId: created.client_message_id,
      body: created.body,
      createdAt: new Date(created.created_at).toISOString(),
      editedAt: created.edited_at
        ? new Date(created.edited_at).toISOString()
        : null,
      deletedAt: created.deleted_at
        ? new Date(created.deleted_at).toISOString()
        : null,
      senderUsername: request.auth.user.username,
      senderDisplayName: request.auth.user.displayName,
      senderAvatarUrl: request.auth.user.avatarUrl,
      attachments: boundAttachmentRows.map(attachmentDto)
    } satisfies RealtimeMessage & { attachments: AttachmentDto[] };

    options.realtimeEvents?.emitMessageCreated({
      conversationId: params.data.id,
      message
    });

    return reply.code(201).send({ message, duplicate: false });
  });
};
