import type { FastifyPluginAsync } from 'fastify';
import { and, eq, or } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '@cubic/database';
import { blocks, friendRequests, friendships, users } from '@cubic/database/schema';
import { createRequireAuth } from '../auth/guard.js';

const userIdSchema = z.object({ userId: z.string().uuid() });
const requestIdParamsSchema = z.object({ id: z.string().uuid() });
const friendIdParamsSchema = z.object({ userId: z.string().uuid() });
const searchQuerySchema = z.object({ q: z.string().trim().min(2).max(64) });

function orderedPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

function publicUser(row: typeof users.$inferSelect) {
  return {
    id: row.id,
    username: row.username,
    displayName: row.displayName,
    avatarUrl: row.avatarUrl,
    createdAt: row.createdAt.toISOString()
  };
}

export interface SocialRoutesOptions {
  database: Database;
  cookieName: string;
}

export const socialRoutes: FastifyPluginAsync<SocialRoutesOptions> = async (app, options) => {
  const requireAuth = createRequireAuth(options.database, options.cookieName);

  app.get('/search', { preHandler: requireAuth }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: 'Authentication required.' });
    const parsed = searchQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: 'Search query must contain at least 2 characters.' });

    const normalized = `%${parsed.data.q.toLowerCase()}%`;
    const result = await options.database.pool.query(
      `select id, username, display_name, avatar_url, created_at
       from users
       where id <> $1 and disabled_at is null
         and (username_normalized like $2 or lower(display_name) like $2)
       order by username_normalized asc
       limit 20`,
      [request.auth.user.id, normalized]
    );

    return reply.send({
      users: result.rows.map((row) => ({
        id: row.id,
        username: row.username,
        displayName: row.display_name,
        avatarUrl: row.avatar_url,
        createdAt: new Date(row.created_at).toISOString()
      }))
    });
  });

  app.get('/friends', { preHandler: requireAuth }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: 'Authentication required.' });
    const userId = request.auth.user.id;
    const result = await options.database.pool.query(
      `select u.id, u.username, u.display_name, u.avatar_url, u.created_at
       from friendships f
       join users u on u.id = case when f.user_low_id = $1 then f.user_high_id else f.user_low_id end
       where f.user_low_id = $1 or f.user_high_id = $1
       order by lower(u.display_name), u.username_normalized`,
      [userId]
    );

    return reply.send({
      friends: result.rows.map((row) => ({
        id: row.id,
        username: row.username,
        displayName: row.display_name,
        avatarUrl: row.avatar_url,
        createdAt: new Date(row.created_at).toISOString()
      }))
    });
  });

  app.get('/requests', { preHandler: requireAuth }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: 'Authentication required.' });
    const userId = request.auth.user.id;
    const result = await options.database.pool.query(
      `select fr.id, fr.sender_id, fr.receiver_id, fr.created_at,
              su.username as sender_username, su.display_name as sender_display_name, su.avatar_url as sender_avatar_url,
              ru.username as receiver_username, ru.display_name as receiver_display_name, ru.avatar_url as receiver_avatar_url
       from friend_requests fr
       join users su on su.id = fr.sender_id
       join users ru on ru.id = fr.receiver_id
       where fr.status = 'pending' and (fr.sender_id = $1 or fr.receiver_id = $1)
       order by fr.created_at desc`,
      [userId]
    );

    return reply.send({
      requests: result.rows.map((row) => ({
        id: row.id,
        direction: row.sender_id === userId ? 'outgoing' : 'incoming',
        createdAt: new Date(row.created_at).toISOString(),
        user: row.sender_id === userId
          ? { id: row.receiver_id, username: row.receiver_username, displayName: row.receiver_display_name, avatarUrl: row.receiver_avatar_url }
          : { id: row.sender_id, username: row.sender_username, displayName: row.sender_display_name, avatarUrl: row.sender_avatar_url }
      }))
    });
  });

  app.post('/requests', { preHandler: requireAuth }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: 'Authentication required.' });
    const parsed = userIdSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid user id.' });
    const me = request.auth.user.id;
    const target = parsed.data.userId;
    if (me === target) return reply.code(400).send({ error: 'You cannot add yourself.' });

    const targetRows = await options.database.db.select().from(users).where(eq(users.id, target)).limit(1);
    if (!targetRows[0] || targetRows[0].disabledAt) return reply.code(404).send({ error: 'User not found.' });

    const [low, high] = orderedPair(me, target);
    const existingFriend = await options.database.db
      .select({ id: friendships.id })
      .from(friendships)
      .where(and(eq(friendships.userLowId, low), eq(friendships.userHighId, high)))
      .limit(1);
    if (existingFriend[0]) return reply.code(409).send({ error: 'You are already friends.' });

    const blocked = await options.database.db
      .select({ id: blocks.id })
      .from(blocks)
      .where(or(and(eq(blocks.blockerId, me), eq(blocks.blockedId, target)), and(eq(blocks.blockerId, target), eq(blocks.blockedId, me))))
      .limit(1);
    if (blocked[0]) return reply.code(403).send({ error: 'Friend request is not allowed.' });

    const reverse = await options.database.db
      .select()
      .from(friendRequests)
      .where(and(eq(friendRequests.senderId, target), eq(friendRequests.receiverId, me), eq(friendRequests.status, 'pending')))
      .limit(1);
    if (reverse[0]) return reply.code(409).send({ error: 'This user already sent you a friend request.' });

    const existing = await options.database.db
      .select()
      .from(friendRequests)
      .where(and(eq(friendRequests.senderId, me), eq(friendRequests.receiverId, target)))
      .limit(1);

    if (existing[0]?.status === 'pending') return reply.code(409).send({ error: 'Friend request already pending.' });

    let created;
    if (existing[0]) {
      [created] = await options.database.db
        .update(friendRequests)
        .set({ status: 'pending', createdAt: new Date(), respondedAt: null })
        .where(eq(friendRequests.id, existing[0].id))
        .returning();
    } else {
      [created] = await options.database.db.insert(friendRequests).values({ senderId: me, receiverId: target }).returning();
    }

    return reply.code(201).send({ request: created });
  });

  app.post('/requests/:id/accept', { preHandler: requireAuth }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: 'Authentication required.' });
    const parsed = requestIdParamsSchema.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid request id.' });

    const rows = await options.database.db
      .select()
      .from(friendRequests)
      .where(and(eq(friendRequests.id, parsed.data.id), eq(friendRequests.receiverId, request.auth.user.id), eq(friendRequests.status, 'pending')))
      .limit(1);
    const pending = rows[0];
    if (!pending) return reply.code(404).send({ error: 'Friend request not found.' });

    const [low, high] = orderedPair(pending.senderId, pending.receiverId);
    await options.database.db.transaction(async (tx) => {
      await tx.insert(friendships).values({ userLowId: low, userHighId: high }).onConflictDoNothing();
      await tx.update(friendRequests).set({ status: 'accepted', respondedAt: new Date() }).where(eq(friendRequests.id, pending.id));
      await tx.update(friendRequests).set({ status: 'accepted', respondedAt: new Date() }).where(and(eq(friendRequests.senderId, pending.receiverId), eq(friendRequests.receiverId, pending.senderId), eq(friendRequests.status, 'pending')));
    });

    return reply.send({ ok: true });
  });

  app.delete('/requests/:id', { preHandler: requireAuth }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: 'Authentication required.' });
    const parsed = requestIdParamsSchema.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid request id.' });

    const rows = await options.database.db.select().from(friendRequests).where(eq(friendRequests.id, parsed.data.id)).limit(1);
    const row = rows[0];
    if (!row || (row.senderId !== request.auth.user.id && row.receiverId !== request.auth.user.id) || row.status !== 'pending') {
      return reply.code(404).send({ error: 'Friend request not found.' });
    }

    await options.database.db
      .update(friendRequests)
      .set({ status: row.senderId === request.auth.user.id ? 'cancelled' : 'declined', respondedAt: new Date() })
      .where(eq(friendRequests.id, row.id));
    return reply.code(204).send();
  });

  app.delete('/friends/:userId', { preHandler: requireAuth }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: 'Authentication required.' });
    const parsed = friendIdParamsSchema.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid user id.' });
    const [low, high] = orderedPair(request.auth.user.id, parsed.data.userId);
    await options.database.db.delete(friendships).where(and(eq(friendships.userLowId, low), eq(friendships.userHighId, high)));
    return reply.code(204).send();
  });

  app.get('/blocks', { preHandler: requireAuth }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: 'Authentication required.' });
    const result = await options.database.pool.query(
      `select u.id, u.username, u.display_name, u.avatar_url, b.created_at
       from blocks b join users u on u.id = b.blocked_id
       where b.blocker_id = $1 order by b.created_at desc`,
      [request.auth.user.id]
    );
    return reply.send({ blocks: result.rows.map((row) => ({ id: row.id, username: row.username, displayName: row.display_name, avatarUrl: row.avatar_url, blockedAt: new Date(row.created_at).toISOString() })) });
  });

  app.post('/blocks', { preHandler: requireAuth }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: 'Authentication required.' });
    const parsed = userIdSchema.safeParse(request.body);
    if (!parsed.success || parsed.data.userId === request.auth.user.id) return reply.code(400).send({ error: 'Invalid user id.' });
    const me = request.auth.user.id;
    const target = parsed.data.userId;
    const [low, high] = orderedPair(me, target);

    await options.database.db.transaction(async (tx) => {
      await tx.insert(blocks).values({ blockerId: me, blockedId: target }).onConflictDoNothing();
      await tx.delete(friendships).where(and(eq(friendships.userLowId, low), eq(friendships.userHighId, high)));
      await tx.update(friendRequests).set({ status: 'cancelled', respondedAt: new Date() }).where(or(and(eq(friendRequests.senderId, me), eq(friendRequests.receiverId, target), eq(friendRequests.status, 'pending')), and(eq(friendRequests.senderId, target), eq(friendRequests.receiverId, me), eq(friendRequests.status, 'pending'))));
    });
    return reply.code(201).send({ ok: true });
  });

  app.delete('/blocks/:userId', { preHandler: requireAuth }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: 'Authentication required.' });
    const parsed = friendIdParamsSchema.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid user id.' });
    await options.database.db.delete(blocks).where(and(eq(blocks.blockerId, request.auth.user.id), eq(blocks.blockedId, parsed.data.userId)));
    return reply.code(204).send();
  });
};
