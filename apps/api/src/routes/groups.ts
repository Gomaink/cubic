import type { FastifyPluginAsync } from 'fastify';
import type { PoolClient } from 'pg';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '@cubic/database';
import { conversationMembers, conversations, friendships } from '@cubic/database/schema';
import { createRequireAuth } from '../auth/guard.js';
import { normalizeLegacyAvatarUrl } from '../auth/identity.js';
import type { SessionService } from '../security/session.js';
import type { LocalMediaStore } from '../media/local.js';
import type { RealtimeEvents } from '../realtime/events.js';
import {
  canChangeGroupRole,
  canDeleteGroup,
  canManageGroup,
  canRemoveGroupMember,
  canTransferGroupOwnership,
  resolveGroupMembership,
  type GroupQueryExecutor,
  type GroupRole
} from '../authorization/groups.js';

const MAX_GROUP_MEMBERS = 50;
const groupParamsSchema = z.object({ id: z.string().uuid() });
const memberParamsSchema = z.object({ id: z.string().uuid(), userId: z.string().uuid() });
const inviteParamsSchema = z.object({ inviteId: z.string().uuid() });
const createGroupSchema = z.object({
  title: z.string().trim().min(1).max(96),
  memberIds: z.array(z.string().uuid()).min(1).max(MAX_GROUP_MEMBERS - 1)
});
const renameGroupSchema = z.object({ title: z.string().trim().min(1).max(96) });
const addMemberSchema = z.object({ userId: z.string().uuid() });
const roleSchema = z.object({ role: z.enum(['admin', 'member']) });
const transferOwnerSchema = z.object({ userId: z.string().uuid() });

function orderedPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

export interface GroupRoutesOptions {
  database: Database;
  cookieName: string;
  sessionService: SessionService;
  realtimeEvents?: RealtimeEvents;
  mediaStore: LocalMediaStore;
  groupAvatarMaxBytes: number;
}

export async function withGroupLock<T>(database: Database, conversationId: string, action: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await database.pool.connect();
  try {
    await client.query('begin');
    await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [conversationId]);
    const result = await action(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function groupUserIds(executor: GroupQueryExecutor, conversationId: string): Promise<string[]> {
  const result = await executor.query('select user_id from conversation_members where conversation_id = $1', [conversationId]);
  return result.rows.map((row) => row.user_id as string);
}

interface LockedGroupInvite {
  id: string;
  conversationId: string;
  inviterId: string;
  inviteeId: string;
  status: string;
}

type LockedGroupInviteResult<T> =
  | { status: 'missing' }
  | { status: 'found'; value: T };

export async function withLockedGroupInvite<T>(
  database: Database,
  inviteId: string,
  action: (client: PoolClient, invite: LockedGroupInvite) => Promise<T>
): Promise<LockedGroupInviteResult<T>> {
  const located = await database.pool.query(
    `select conversation_id
       from group_invites
      where id = $1
      limit 1`,
    [inviteId]
  );
  const conversationId = located.rows[0]?.conversation_id as string | undefined;
  if (!conversationId) return { status: 'missing' };

  return withGroupLock(database, conversationId, async (client) => {
    const current = await client.query(
      `select id, conversation_id, inviter_id, invitee_id, status
         from group_invites
        where id = $1 and conversation_id = $2
        for update`,
      [inviteId, conversationId]
    );
    const row = current.rows[0];
    if (!row) return { status: 'missing' };

    return {
      status: 'found',
      value: await action(client, {
        id: row.id as string,
        conversationId: row.conversation_id as string,
        inviterId: row.inviter_id as string,
        inviteeId: row.invitee_id as string,
        status: row.status as string
      })
    };
  });
}

async function ensureFriendAllowed(database: Database, actorId: string, targetId: string): Promise<boolean> {
  if (actorId === targetId) return false;
  const [low, high] = orderedPair(actorId, targetId);
  const friend = await database.db
    .select({ id: friendships.id })
    .from(friendships)
    .where(and(eq(friendships.userLowId, low), eq(friendships.userHighId, high)))
    .limit(1);
  if (!friend[0]) return false;

  const blockedEitherWay = await database.pool.query(
    `select 1 from blocks
      where (blocker_id = $1 and blocked_id = $2)
         or (blocker_id = $2 and blocked_id = $1)
      limit 1`,
    [actorId, targetId]
  );
  return !blockedEitherWay.rowCount;
}

function groupAvatarUrl(id: string, avatarKey: string | null, updatedAt: Date): string | null {
  if (!avatarKey) return null;
  return `/api/v1/groups/${id}/avatar?v=${updatedAt.getTime()}`;
}

async function serializeGroup(database: Database, conversationId: string, userId: string) {
  const group = await database.pool.query(
    `select c.id, c.title, c.avatar_key, c.created_by, c.created_at, c.updated_at, mine.role
       from conversations c
       join conversation_members mine on mine.conversation_id = c.id and mine.user_id = $2
      where c.id = $1 and c.kind = 'group'
      limit 1`,
    [conversationId, userId]
  );
  const row = group.rows[0];
  if (!row) return null;

  const members = await database.pool.query(
    `select u.id, u.username, u.display_name, u.avatar_url, cm.role, cm.joined_at
       from conversation_members cm
       join users u on u.id = cm.user_id
      where cm.conversation_id = $1
      order by case cm.role when 'owner' then 0 when 'admin' then 1 else 2 end,
               lower(u.display_name), u.id`,
    [conversationId]
  );

  const pendingInvites = canManageGroup(row.role)
    ? await database.pool.query(
        `select gi.id, gi.invitee_id, gi.created_at, u.username, u.display_name, u.avatar_url
           from group_invites gi
           join users u on u.id = gi.invitee_id
          where gi.conversation_id = $1 and gi.status = 'pending'
          order by gi.created_at asc`,
        [conversationId]
      )
    : { rows: [] };

  const updatedAt = new Date(row.updated_at);
  return {
    id: row.id,
    title: row.title,
    avatarUrl: groupAvatarUrl(row.id, row.avatar_key, updatedAt),
    createdBy: row.created_by,
    currentRole: row.role as GroupRole,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: updatedAt.toISOString(),
    members: members.rows.map((member) => ({
      id: member.id,
      username: member.username,
      displayName: member.display_name,
      avatarUrl: normalizeLegacyAvatarUrl(member.avatar_url),
      role: member.role as GroupRole,
      joinedAt: new Date(member.joined_at).toISOString()
    })),
    pendingInvites: pendingInvites.rows.map((invite) => ({
      id: invite.id,
      user: {
        id: invite.invitee_id,
        username: invite.username,
        displayName: invite.display_name,
        avatarUrl: normalizeLegacyAvatarUrl(invite.avatar_url)
      },
      createdAt: new Date(invite.created_at).toISOString()
    }))
  };
}

export const groupRoutes: FastifyPluginAsync<GroupRoutesOptions> = async (app, options) => {
  const requireAuth = createRequireAuth(options.sessionService, options.cookieName);

  app.get('/invites', { preHandler: requireAuth }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: 'Authentication required.' });
    const result = await options.database.pool.query(
      `select gi.id, gi.conversation_id, gi.created_at,
              c.title, c.avatar_key, c.updated_at,
              inviter.id as inviter_id, inviter.username as inviter_username, inviter.display_name as inviter_display_name
         from group_invites gi
         join conversations c on c.id = gi.conversation_id and c.kind = 'group'
         join users inviter on inviter.id = gi.inviter_id
        where gi.invitee_id = $1 and gi.status = 'pending'
        order by gi.created_at desc`,
      [request.auth.user.id]
    );

    return reply.send({
      invites: result.rows.map((row) => ({
        id: row.id,
        conversationId: row.conversation_id,
        group: {
          id: row.conversation_id,
          title: row.title,
          avatarUrl: groupAvatarUrl(row.conversation_id, row.avatar_key, new Date(row.updated_at))
        },
        inviter: {
          id: row.inviter_id,
          username: row.inviter_username,
          displayName: row.inviter_display_name
        },
        createdAt: new Date(row.created_at).toISOString()
      }))
    });
  });

  app.post('/invites/:inviteId/accept', { preHandler: requireAuth }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: 'Authentication required.' });
    const params = inviteParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'Invalid invitation.' });
    const me = request.auth.user.id;

    const locked = await withLockedGroupInvite(options.database, params.data.inviteId, async (client, invite) => {
      if (invite.inviteeId !== me) return { status: 'missing' as const };
      if (invite.status !== 'pending') return { status: 'stale' as const };

      const group = await client.query(
        `select 1 from conversations where id = $1 and kind = 'group' limit 1`,
        [invite.conversationId]
      );
      if (!group.rowCount) {
        const cancelled = await client.query(
          `update group_invites
              set status = 'cancelled', responded_at = now()
            where id = $1 and status = 'pending'
          returning id`,
          [invite.id]
        );
        if (!cancelled.rowCount) throw new Error('Pending group invitation changed while locked.');
        return { status: 'gone' as const };
      }

      const count = await client.query(
        `select count(*)::int as count from conversation_members where conversation_id = $1`,
        [invite.conversationId]
      );
      const isMember = await client.query(
        `select 1 from conversation_members where conversation_id = $1 and user_id = $2 limit 1`,
        [invite.conversationId, me]
      );
      if (!isMember.rowCount && Number(count.rows[0]?.count ?? 0) >= MAX_GROUP_MEMBERS) {
        return { status: 'full' as const };
      }

      await client.query(
        `insert into conversation_members (conversation_id, user_id, role)
         values ($1, $2, 'member')
         on conflict (conversation_id, user_id) do nothing`,
        [invite.conversationId, me]
      );
      const accepted = await client.query(
        `update group_invites
            set status = 'accepted', responded_at = now()
          where id = $1 and status = 'pending'
        returning id`,
        [invite.id]
      );
      if (!accepted.rowCount) throw new Error('Pending group invitation changed while locked.');
      await client.query(`update conversations set updated_at = now() where id = $1`, [invite.conversationId]);
      return {
        status: 'accepted' as const,
        conversationId: invite.conversationId,
        userIds: await groupUserIds(client, invite.conversationId)
      };
    });

    if (locked.status === 'missing' || locked.value.status === 'missing') {
      return reply.code(404).send({ error: 'Invitation not found.' });
    }
    if (locked.value.status === 'stale') return reply.code(409).send({ error: 'Invitation is no longer pending.' });
    if (locked.value.status === 'gone') return reply.code(410).send({ error: 'Group no longer exists.' });
    if (locked.value.status === 'full') return reply.code(409).send({ error: 'Group is full.' });

    options.realtimeEvents?.emitConversationOpened({
      conversationId: locked.value.conversationId,
      userIds: locked.value.userIds
    });
    options.realtimeEvents?.emitGroupInvitesChanged({ userIds: [me] });
    return reply.send({ group: await serializeGroup(options.database, locked.value.conversationId, me) });
  });

  app.post('/invites/:inviteId/decline', { preHandler: requireAuth }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: 'Authentication required.' });
    const params = inviteParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'Invalid invitation.' });
    const me = request.auth.user.id;
    const locked = await withLockedGroupInvite(options.database, params.data.inviteId, async (client, invite) => {
      if (invite.inviteeId !== me || invite.status !== 'pending') return { status: 'missing' as const };
      const declined = await client.query(
        `update group_invites
            set status = 'declined', responded_at = now()
          where id = $1 and invitee_id = $2 and status = 'pending'
        returning id`,
        [invite.id, me]
      );
      if (!declined.rowCount) throw new Error('Pending group invitation changed while locked.');
      return {
        status: 'declined' as const,
        conversationId: invite.conversationId,
        userIds: await groupUserIds(client, invite.conversationId)
      };
    });
    if (locked.status === 'missing' || locked.value.status === 'missing') {
      return reply.code(404).send({ error: 'Invitation not found.' });
    }

    options.realtimeEvents?.emitGroupInvitesChanged({ userIds: [me] });
    options.realtimeEvents?.emitConversationChanged({
      conversationId: locked.value.conversationId,
      userIds: locked.value.userIds
    });
    return reply.code(204).send();
  });

  app.delete('/invites/:inviteId', { preHandler: requireAuth }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: 'Authentication required.' });
    const params = inviteParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'Invalid invitation.' });

    const actorId = request.auth.user.id;
    const locked = await withLockedGroupInvite(options.database, params.data.inviteId, async (client, invite) => {
      if (invite.status !== 'pending') return { status: 'missing' as const };
      const membership = await resolveGroupMembership(client, invite.conversationId, actorId);
      if (invite.inviterId !== actorId && (!membership || !canManageGroup(membership.role))) {
        return { status: 'forbidden' as const };
      }

      const cancelled = await client.query(
        `update group_invites
            set status = 'cancelled', responded_at = now()
          where id = $1 and status = 'pending'
        returning id`,
        [invite.id]
      );
      if (!cancelled.rowCount) throw new Error('Pending group invitation changed while locked.');
      return {
        status: 'cancelled' as const,
        conversationId: invite.conversationId,
        inviteeId: invite.inviteeId,
        userIds: await groupUserIds(client, invite.conversationId)
      };
    });
    if (locked.status === 'missing' || locked.value.status === 'missing') {
      return reply.code(404).send({ error: 'Invitation not found.' });
    }
    if (locked.value.status === 'forbidden') {
      return reply.code(403).send({ error: 'You cannot cancel this invitation.' });
    }

    options.realtimeEvents?.emitGroupInvitesChanged({ userIds: [locked.value.inviteeId] });
    options.realtimeEvents?.emitConversationChanged({
      conversationId: locked.value.conversationId,
      userIds: locked.value.userIds
    });
    return reply.code(204).send();
  });

  app.post('/', { preHandler: requireAuth }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: 'Authentication required.' });
    const parsed = createGroupSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid group.' });

    const me = request.auth.user.id;
    const memberIds = [...new Set(parsed.data.memberIds)].filter((id) => id !== me);
    if (memberIds.length === 0) return reply.code(400).send({ error: 'Choose at least one friend.' });

    for (const userId of memberIds) {
      const exists = await options.database.pool.query('select 1 from users where id = $1 and disabled_at is null limit 1', [userId]);
      if (!exists.rowCount) return reply.code(400).send({ error: 'One or more users are unavailable.' });
      if (!(await ensureFriendAllowed(options.database, me, userId))) {
        return reply.code(403).send({ error: 'Groups can only include available friends in alpha.4.' });
      }
    }

    const conversationId = await options.database.db.transaction(async (tx) => {
      const [conversation] = await tx.insert(conversations).values({ kind: 'group', title: parsed.data.title, createdBy: me }).returning({ id: conversations.id });
      if (!conversation) throw new Error('Failed to create group.');
      await tx.insert(conversationMembers).values([
        { conversationId: conversation.id, userId: me, role: 'owner' },
        ...memberIds.map((userId) => ({ conversationId: conversation.id, userId, role: 'member' }))
      ]);
      return conversation.id;
    });

    options.realtimeEvents?.emitConversationOpened({ conversationId, userIds: [me, ...memberIds] });
    return reply.code(201).send({ group: await serializeGroup(options.database, conversationId, me) });
  });

  app.get('/:id/avatar', { preHandler: requireAuth }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: 'Authentication required.' });
    const params = groupParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'Invalid group.' });
    const access = await options.database.pool.query(
      `select c.avatar_key
         from conversations c
        where c.id = $1 and c.kind = 'group' and c.avatar_key is not null
          and (
            exists (select 1 from conversation_members cm where cm.conversation_id = c.id and cm.user_id = $2)
            or exists (select 1 from group_invites gi where gi.conversation_id = c.id and gi.invitee_id = $2 and gi.status = 'pending')
          )
        limit 1`,
      [params.data.id, request.auth.user.id]
    );
    const avatarKey = access.rows[0]?.avatar_key as string | undefined;
    if (!avatarKey) return reply.code(404).send({ error: 'Avatar not found.' });

    try {
      const media = await options.mediaStore.readGroupAvatar(avatarKey);
      reply.header('cache-control', 'private, max-age=86400, immutable');
      reply.header('x-content-type-options', 'nosniff');
      const extension = media.contentType === 'image/png' ? 'png' : media.contentType === 'image/jpeg' ? 'jpg' : 'webp';
      reply.header('content-disposition', `inline; filename="group-avatar.${extension}"`);
      return reply.type(media.contentType).send(media.buffer);
    } catch {
      return reply.code(404).send({ error: 'Avatar not found.' });
    }
  });

  app.post('/:id/avatar', { preHandler: requireAuth }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: 'Authentication required.' });
    const params = groupParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'Invalid group.' });
    const membership = await resolveGroupMembership(options.database.pool, params.data.id, request.auth.user.id);
    if (!membership) return reply.code(404).send({ error: 'Group not found.' });
    if (!canManageGroup(membership.role)) return reply.code(403).send({ error: 'Group management requires admin permission.' });

    const part = await request.file().catch(() => null);
    if (!part) return reply.code(400).send({ error: 'Choose a PNG, JPEG or WebP avatar up to 2 MB.' });

    let buffer: Buffer;
    try {
      buffer = await part.toBuffer();
    } catch {
      return reply.code(413).send({ error: 'Avatar is too large.' });
    }
    if (part.file.truncated || buffer.length > options.groupAvatarMaxBytes) return reply.code(413).send({ error: 'Avatar is too large.' });

    let stored;
    try {
      stored = await options.mediaStore.saveGroupAvatar(buffer);
    } catch {
      return reply.code(415).send({ error: 'Use a PNG, JPEG or WebP image.' });
    }

    let replacement:
      | { status: 'missing' | 'forbidden' }
      | { status: 'updated'; previousKey: string | null; userIds: string[] };
    try {
      replacement = await withGroupLock(options.database, params.data.id, async (client) => {
        const current = await resolveGroupMembership(client, params.data.id, request.auth!.user.id);
        if (!current) return { status: 'missing' as const };
        if (!canManageGroup(current.role)) return { status: 'forbidden' as const };

        await client.query(
          `update conversations set avatar_key = $2, updated_at = now() where id = $1`,
          [params.data.id, stored.key]
        );
        return {
          status: 'updated' as const,
          previousKey: current.avatarKey,
          userIds: await groupUserIds(client, params.data.id)
        };
      });
    } catch (error) {
      await options.mediaStore.deleteGroupAvatar(stored.key).catch(() => {});
      throw error;
    }

    if (replacement.status !== 'updated') {
      await options.mediaStore.deleteGroupAvatar(stored.key).catch(() => {});
      return replacement.status === 'missing'
        ? reply.code(404).send({ error: 'Group not found.' })
        : reply.code(403).send({ error: 'Group management requires admin permission.' });
    }

    await options.mediaStore.deleteGroupAvatar(replacement.previousKey).catch(() => {});
    options.realtimeEvents?.emitConversationChanged({
      conversationId: params.data.id,
      userIds: replacement.userIds
    });
    return reply.send({ group: await serializeGroup(options.database, params.data.id, request.auth.user.id) });
  });

  app.delete('/:id/avatar', { preHandler: requireAuth }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: 'Authentication required.' });
    const params = groupParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'Invalid group.' });
    const membership = await resolveGroupMembership(options.database.pool, params.data.id, request.auth.user.id);
    if (!membership) return reply.code(404).send({ error: 'Group not found.' });
    if (!canManageGroup(membership.role)) return reply.code(403).send({ error: 'Group management requires admin permission.' });

    const removal = await withGroupLock(options.database, params.data.id, async (client) => {
      const current = await resolveGroupMembership(client, params.data.id, request.auth!.user.id);
      if (!current) return { status: 'missing' as const };
      if (!canManageGroup(current.role)) return { status: 'forbidden' as const };

      await client.query(
        `update conversations set avatar_key = null, updated_at = now() where id = $1`,
        [params.data.id]
      );
      return {
        status: 'removed' as const,
        previousKey: current.avatarKey,
        userIds: await groupUserIds(client, params.data.id)
      };
    });
    if (removal.status === 'missing') return reply.code(404).send({ error: 'Group not found.' });
    if (removal.status === 'forbidden') return reply.code(403).send({ error: 'Group management requires admin permission.' });

    await options.mediaStore.deleteGroupAvatar(removal.previousKey).catch(() => {});
    options.realtimeEvents?.emitConversationChanged({
      conversationId: params.data.id,
      userIds: removal.userIds
    });
    return reply.code(204).send();
  });

  app.get('/:id', { preHandler: requireAuth }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: 'Authentication required.' });
    const params = groupParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'Invalid group.' });
    const group = await serializeGroup(options.database, params.data.id, request.auth.user.id);
    if (!group) return reply.code(404).send({ error: 'Group not found.' });
    return reply.send({ group });
  });

  app.patch('/:id', { preHandler: requireAuth }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: 'Authentication required.' });
    const params = groupParamsSchema.safeParse(request.params);
    const parsed = renameGroupSchema.safeParse(request.body);
    if (!params.success || !parsed.success) return reply.code(400).send({ error: 'Invalid group.' });
    const membership = await resolveGroupMembership(options.database.pool, params.data.id, request.auth.user.id);
    if (!membership) return reply.code(404).send({ error: 'Group not found.' });
    if (!canManageGroup(membership.role)) return reply.code(403).send({ error: 'Group management requires admin permission.' });
    const result = await withGroupLock(options.database, params.data.id, async (client) => {
      const current = await resolveGroupMembership(client, params.data.id, request.auth!.user.id);
      if (!current) return { status: 'missing' as const };
      if (!canManageGroup(current.role)) return { status: 'forbidden' as const };

      await client.query(
        `update conversations set title = $2, updated_at = now() where id = $1`,
        [params.data.id, parsed.data.title]
      );
      return {
        status: 'renamed' as const,
        userIds: await groupUserIds(client, params.data.id)
      };
    });
    if (result.status === 'missing') return reply.code(404).send({ error: 'Group not found.' });
    if (result.status === 'forbidden') return reply.code(403).send({ error: 'Group management requires admin permission.' });

    options.realtimeEvents?.emitConversationChanged({
      conversationId: params.data.id,
      userIds: result.userIds
    });
    return reply.send({ group: await serializeGroup(options.database, params.data.id, request.auth.user.id) });
  });

  app.post('/:id/invites', { preHandler: requireAuth }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: 'Authentication required.' });
    const params = groupParamsSchema.safeParse(request.params);
    const parsed = addMemberSchema.safeParse(request.body);
    if (!params.success || !parsed.success) return reply.code(400).send({ error: 'Invalid invitation.' });
    const me = request.auth.user.id;
    const membership = await resolveGroupMembership(options.database.pool, params.data.id, me);
    if (!membership) return reply.code(404).send({ error: 'Group not found.' });
    if (!canManageGroup(membership.role)) return reply.code(403).send({ error: 'Group management requires admin permission.' });
    if (!(await ensureFriendAllowed(options.database, me, parsed.data.userId))) return reply.code(403).send({ error: 'You can only invite available friends.' });

    const invite = await withGroupLock(options.database, params.data.id, async (client) => {
      const current = await resolveGroupMembership(client, params.data.id, me);
      if (!current) return { error: 'missing' as const };
      if (!canManageGroup(current.role)) return { error: 'forbidden' as const };

      const exists = await client.query(`select 1 from conversation_members where conversation_id = $1 and user_id = $2 limit 1`, [params.data.id, parsed.data.userId]);
      if (exists.rowCount) return { error: 'member' as const };
      await client.query(
        `select id, status
           from group_invites
          where conversation_id = $1 and invitee_id = $2
          for update`,
        [params.data.id, parsed.data.userId]
      );
      const counts = await client.query(
        `select
           (select count(*)::int from conversation_members where conversation_id = $1) as members,
           (select count(*)::int from group_invites where conversation_id = $1 and status = 'pending') as invites`,
        [params.data.id]
      );
      if (Number(counts.rows[0]?.members ?? 0) + Number(counts.rows[0]?.invites ?? 0) >= MAX_GROUP_MEMBERS) return { error: 'full' as const };
      const result = await client.query(
        `insert into group_invites (conversation_id, inviter_id, invitee_id, status, created_at, responded_at)
         values ($1, $2, $3, 'pending', now(), null)
         on conflict (conversation_id, invitee_id)
         do update set inviter_id = excluded.inviter_id, status = 'pending', created_at = now(), responded_at = null
         returning id`,
        [params.data.id, me, parsed.data.userId]
      );
      return {
        id: result.rows[0].id as string,
        userIds: await groupUserIds(client, params.data.id)
      };
    });
    if ('error' in invite) {
      if (invite.error === 'missing') return reply.code(404).send({ error: 'Group not found.' });
      if (invite.error === 'forbidden') return reply.code(403).send({ error: 'Group management requires admin permission.' });
      if (invite.error === 'member') return reply.code(409).send({ error: 'User is already a group member.' });
      return reply.code(409).send({ error: 'Group is full.' });
    }

    options.realtimeEvents?.emitGroupInvitesChanged({ userIds: [parsed.data.userId] });
    options.realtimeEvents?.emitConversationChanged({ conversationId: params.data.id, userIds: invite.userIds });
    return reply.code(201).send({ group: await serializeGroup(options.database, params.data.id, me) });
  });

  // Kept for internal/backward compatibility during alpha.4; the UI uses explicit invites.
  app.post('/:id/members', { preHandler: requireAuth }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: 'Authentication required.' });
    const params = groupParamsSchema.safeParse(request.params);
    const parsed = addMemberSchema.safeParse(request.body);
    if (!params.success || !parsed.success) return reply.code(400).send({ error: 'Invalid member.' });
    const me = request.auth.user.id;
    const membership = await resolveGroupMembership(options.database.pool, params.data.id, me);
    if (!membership) return reply.code(404).send({ error: 'Group not found.' });
    if (!canManageGroup(membership.role)) return reply.code(403).send({ error: 'Group management requires admin permission.' });
    if (!(await ensureFriendAllowed(options.database, me, parsed.data.userId))) return reply.code(403).send({ error: 'You can only add available friends.' });

    const result = await withGroupLock(options.database, params.data.id, async (client) => {
      const current = await resolveGroupMembership(client, params.data.id, me);
      if (!current) return { status: 'missing' as const };
      if (!canManageGroup(current.role)) return { status: 'forbidden' as const };

      const count = await client.query(`select count(*)::int as count from conversation_members where conversation_id = $1`, [params.data.id]);
      if (Number(count.rows[0]?.count ?? 0) >= MAX_GROUP_MEMBERS) return { status: 'full' as const };
      const inserted = await client.query(
        `insert into conversation_members (conversation_id, user_id, role)
         values ($1, $2, 'member')
         on conflict (conversation_id, user_id) do nothing
         returning user_id`,
        [params.data.id, parsed.data.userId]
      );
      if (!inserted.rowCount) return { status: 'exists' as const };
      await client.query(`update group_invites set status = 'accepted', responded_at = now() where conversation_id = $1 and invitee_id = $2 and status = 'pending'`, [params.data.id, parsed.data.userId]);
      await client.query(`update conversations set updated_at = now() where id = $1`, [params.data.id]);
      return {
        status: 'added' as const,
        userIds: await groupUserIds(client, params.data.id)
      };
    });
    if (result.status === 'missing') return reply.code(404).send({ error: 'Group not found.' });
    if (result.status === 'forbidden') return reply.code(403).send({ error: 'Group management requires admin permission.' });
    if (result.status === 'full') return reply.code(409).send({ error: 'Group is full.' });
    if (result.status === 'exists') return reply.code(409).send({ error: 'User is already a group member.' });

    options.realtimeEvents?.emitConversationOpened({
      conversationId: params.data.id,
      userIds: result.userIds
    });
    options.realtimeEvents?.emitGroupInvitesChanged({ userIds: [parsed.data.userId] });
    return reply.code(201).send({ group: await serializeGroup(options.database, params.data.id, me) });
  });

  app.patch('/:id/members/:userId', { preHandler: requireAuth }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: 'Authentication required.' });
    const params = memberParamsSchema.safeParse(request.params);
    const parsed = roleSchema.safeParse(request.body);
    if (!params.success || !parsed.success) return reply.code(400).send({ error: 'Invalid role change.' });

    const result = await withGroupLock(options.database, params.data.id, async (client) => {
      const actor = await resolveGroupMembership(client, params.data.id, request.auth!.user.id);
      const target = await resolveGroupMembership(client, params.data.id, params.data.userId);
      if (!actor || !target) return { status: 'missing' as const };
      if (!canChangeGroupRole(actor.role, target.role)) return { status: 'forbidden' as const };
      await client.query(`update conversation_members set role = $3 where conversation_id = $1 and user_id = $2`, [params.data.id, params.data.userId, parsed.data.role]);
      return {
        status: 'updated' as const,
        userIds: await groupUserIds(client, params.data.id)
      };
    });
    if (result.status === 'missing') return reply.code(404).send({ error: 'Group member not found.' });
    if (result.status === 'forbidden') return reply.code(403).send({ error: 'Only the owner can change admin roles.' });

    options.realtimeEvents?.emitConversationChanged({
      conversationId: params.data.id,
      userIds: result.userIds
    });
    return reply.send({ group: await serializeGroup(options.database, params.data.id, request.auth.user.id) });
  });

  app.delete('/:id/members/:userId', { preHandler: requireAuth }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: 'Authentication required.' });
    const params = memberParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'Invalid member.' });
    if (params.data.userId === request.auth.user.id) return reply.code(400).send({ error: 'Use leave group for your own membership.' });

    const result = await withGroupLock(options.database, params.data.id, async (client) => {
      const actor = await resolveGroupMembership(client, params.data.id, request.auth!.user.id);
      const target = await resolveGroupMembership(client, params.data.id, params.data.userId);
      if (!actor || !target) return { status: 'missing' as const };
      if (!canRemoveGroupMember(actor.role, target.role)) return { status: 'forbidden' as const };
      await client.query(`delete from conversation_members where conversation_id = $1 and user_id = $2`, [params.data.id, params.data.userId]);
      await client.query(`update conversations set updated_at = now() where id = $1`, [params.data.id]);
      return {
        status: 'removed' as const,
        remainingUserIds: await groupUserIds(client, params.data.id)
      };
    });
    if (result.status === 'missing') return reply.code(404).send({ error: 'Group member not found.' });
    if (result.status === 'forbidden') return reply.code(403).send({ error: 'You cannot remove this member.' });

    options.realtimeEvents?.emitConversationRemoved({
      conversationId: params.data.id,
      removedUserIds: [params.data.userId],
      remainingUserIds: result.remainingUserIds
    });
    return reply.send({ group: await serializeGroup(options.database, params.data.id, request.auth.user.id) });
  });

  app.post('/:id/transfer-owner', { preHandler: requireAuth }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: 'Authentication required.' });
    const params = groupParamsSchema.safeParse(request.params);
    const parsed = transferOwnerSchema.safeParse(request.body);
    if (!params.success || !parsed.success) return reply.code(400).send({ error: 'Invalid ownership transfer.' });
    const me = request.auth.user.id;

    const result = await withGroupLock(options.database, params.data.id, async (client) => {
      const actor = await resolveGroupMembership(client, params.data.id, me);
      const target = await resolveGroupMembership(client, params.data.id, parsed.data.userId);
      if (!actor || !target) return { status: 'missing' as const };
      if (!canTransferGroupOwnership(actor.role)) return { status: 'forbidden' as const };
      if (parsed.data.userId === me) return { status: 'self' as const };
      await client.query(`update conversation_members set role = 'admin' where conversation_id = $1 and user_id = $2`, [params.data.id, me]);
      await client.query(`update conversation_members set role = 'owner' where conversation_id = $1 and user_id = $2`, [params.data.id, parsed.data.userId]);
      return {
        status: 'transferred' as const,
        userIds: await groupUserIds(client, params.data.id)
      };
    });
    if (result.status === 'missing') return reply.code(404).send({ error: 'Group member not found.' });
    if (result.status === 'forbidden') return reply.code(403).send({ error: 'Only the owner can transfer ownership.' });
    if (result.status === 'self') return reply.code(400).send({ error: 'You already own this group.' });

    options.realtimeEvents?.emitConversationChanged({
      conversationId: params.data.id,
      userIds: result.userIds
    });
    return reply.send({ group: await serializeGroup(options.database, params.data.id, me) });
  });

  app.post('/:id/leave', { preHandler: requireAuth }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: 'Authentication required.' });
    const params = groupParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'Invalid group.' });
    const me = request.auth.user.id;

    const result = await withGroupLock(options.database, params.data.id, async (client) => {
      const membership = await resolveGroupMembership(client, params.data.id, me);
      if (!membership) return { status: 'missing' as const };
      const count = await client.query(`select count(*)::int as count from conversation_members where conversation_id = $1`, [params.data.id]);
      if (membership.role === 'owner' && Number(count.rows[0]?.count ?? 0) > 1) return { status: 'transfer' as const };
      if (membership.role === 'owner') {
        await client.query(`delete from conversations where id = $1`, [params.data.id]);
        return { status: 'deleted' as const, remainingUserIds: [] };
      }
      await client.query(`delete from conversation_members where conversation_id = $1 and user_id = $2`, [params.data.id, me]);
      return {
        status: 'left' as const,
        remainingUserIds: await groupUserIds(client, params.data.id)
      };
    });
    if (result.status === 'missing') return reply.code(404).send({ error: 'Group not found.' });
    if (result.status === 'transfer') return reply.code(409).send({ error: 'Transfer ownership before leaving the group.' });

    options.realtimeEvents?.emitConversationRemoved({
      conversationId: params.data.id,
      removedUserIds: [me],
      remainingUserIds: result.remainingUserIds
    });
    return reply.code(204).send();
  });

  app.delete('/:id', { preHandler: requireAuth }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: 'Authentication required.' });
    const params = groupParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'Invalid group.' });
    const me = request.auth.user.id;
    const before = await resolveGroupMembership(options.database.pool, params.data.id, me);
    if (!before) return reply.code(404).send({ error: 'Group not found.' });
    if (!canDeleteGroup(before.role)) return reply.code(403).send({ error: 'Only the owner can delete the group.' });

    const deleted = await withGroupLock(options.database, params.data.id, async (client) => {
      const membership = await resolveGroupMembership(client, params.data.id, me);
      if (!membership || !canDeleteGroup(membership.role)) return null;
      const userIds = await groupUserIds(client, params.data.id);
      await client.query(`delete from conversations where id = $1`, [params.data.id]);
      return { userIds, avatarKey: membership.avatarKey };
    });
    if (!deleted) return reply.code(409).send({ error: 'Group ownership changed. Refresh and try again.' });
    await options.mediaStore.deleteGroupAvatar(deleted.avatarKey).catch(() => {});
    options.realtimeEvents?.emitConversationRemoved({ conversationId: params.data.id, removedUserIds: deleted.userIds, remainingUserIds: [] });
    return reply.code(204).send();
  });
};
