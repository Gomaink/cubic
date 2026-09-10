import type { FastifyPluginAsync } from 'fastify';
import { and, desc, eq, lt } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '@cubic/database';
import { blocks, conversationMembers, conversations, directConversationPairs, friendships, messages, users } from '@cubic/database/schema';
import { createRequireAuth } from '../auth/guard.js';
import type { RealtimeEvents, RealtimeMessage } from '../realtime/events.js';

const directBodySchema = z.object({ userId: z.string().uuid() });
const conversationParamsSchema = z.object({ id: z.string().uuid() });
const messagesQuerySchema = z.object({ before: z.string().datetime().optional(), limit: z.coerce.number().int().min(1).max(100).default(50) });
const messageBodySchema = z.object({ clientMessageId: z.string().uuid(), body: z.string().trim().min(1).max(8000) });

function orderedPair(a: string, b: string): [string, string] { return a < b ? [a, b] : [b, a]; }

export interface ConversationRoutesOptions { database: Database; cookieName: string; realtimeEvents?: RealtimeEvents; }

async function isMember(database: Database, conversationId: string, userId: string): Promise<boolean> {
  const rows = await database.db.select({ userId: conversationMembers.userId }).from(conversationMembers)
    .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, userId))).limit(1);
  return Boolean(rows[0]);
}

export const conversationRoutes: FastifyPluginAsync<ConversationRoutesOptions> = async (app, options) => {
  const requireAuth = createRequireAuth(options.database, options.cookieName);

  app.get('/', { preHandler: requireAuth }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: 'Authentication required.' });
    const result = await options.database.pool.query(
      `select c.id, c.kind, c.title, c.created_at, c.updated_at,
              peer.id as peer_id, peer.username as peer_username, peer.display_name as peer_display_name, peer.avatar_url as peer_avatar_url,
              lm.id as last_message_id, lm.body as last_message_body, lm.created_at as last_message_at, lm.sender_id as last_message_sender_id
       from conversation_members mine
       join conversations c on c.id = mine.conversation_id
       left join direct_conversation_pairs dp on dp.conversation_id = c.id
       left join users peer on peer.id = case when dp.user_low_id = $1 then dp.user_high_id else dp.user_low_id end
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
      id: row.id, kind: row.kind, title: row.title, createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString(),
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
    if (!friend[0]) return reply.code(403).send({ error: 'Direct conversations are limited to friends in alpha.3.' });

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
    return reply.send({
      messages: page.map((row) => ({ ...row, createdAt: row.createdAt.toISOString(), editedAt: row.editedAt?.toISOString() ?? null, deletedAt: row.deletedAt?.toISOString() ?? null })),
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
    if (existing[0]) return reply.send({ message: { ...existing[0], createdAt: existing[0].createdAt.toISOString(), editedAt: existing[0].editedAt?.toISOString() ?? null, deletedAt: existing[0].deletedAt?.toISOString() ?? null }, duplicate: true });

    const now = new Date();
    const [created] = await options.database.db.insert(messages).values({ conversationId: params.data.id, senderId: me, clientMessageId: parsed.data.clientMessageId, body: parsed.data.body, createdAt: now }).returning();
    if (!created) throw new Error('Failed to persist message.');

    await options.database.db.update(conversations).set({ updatedAt: now }).where(eq(conversations.id, params.data.id));

    const message: RealtimeMessage = {
      ...created,
      createdAt: created.createdAt.toISOString(),
      editedAt: created.editedAt?.toISOString() ?? null,
      deletedAt: created.deletedAt?.toISOString() ?? null,
      senderUsername: request.auth.user.username,
      senderDisplayName: request.auth.user.displayName,
      senderAvatarUrl: request.auth.user.avatarUrl
    };

    options.realtimeEvents?.emitMessageCreated({
      conversationId: params.data.id,
      message
    });

    return reply.code(201).send({ message, duplicate: false });
  });
};
