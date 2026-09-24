import type { PoolClient } from 'pg';
import type { Database } from '@cubic/database';
import { normalizeLegacyAvatarUrl } from '../auth/identity.js';

type Denial = 'not_found' | 'not_owner' | 'not_friend' | 'member' | 'pending' | 'owner';
type Result<T> = { value: T } | { denied: Denial };

export interface ServerInviteRecord {
  id: string;
  serverId: string;
  serverName: string;
  invitee: { id: string; username: string; displayName: string; avatarUrl: string | null };
  inviter: { id: string; username: string; displayName: string; avatarUrl: string | null };
  createdAt: string;
}

function record(row: any): ServerInviteRecord {
  return {
    id: row.id,
    serverId: row.server_id,
    serverName: row.server_name,
    invitee: { id: row.invitee_user_id, username: row.invitee_username, displayName: row.invitee_display_name, avatarUrl: normalizeLegacyAvatarUrl(row.invitee_avatar_url) },
    inviter: { id: row.inviter_user_id, username: row.inviter_username, displayName: row.inviter_display_name, avatarUrl: normalizeLegacyAvatarUrl(row.inviter_avatar_url) },
    createdAt: new Date(row.created_at).toISOString()
  };
}

const inviteProjection = `select i.id, i.server_id, s.name as server_name, i.inviter_user_id,
  inviter.username as inviter_username, inviter.display_name as inviter_display_name, inviter.avatar_url as inviter_avatar_url,
  i.invitee_user_id, invitee.username as invitee_username,
  invitee.display_name as invitee_display_name, invitee.avatar_url as invitee_avatar_url, i.created_at
  from server_invites i
  join servers s on s.id = i.server_id
  join users inviter on inviter.id = i.inviter_user_id
  join users invitee on invitee.id = i.invitee_user_id`;

async function withServerTransaction<T>(database: Database, serverId: string, action: (client: PoolClient, ownerId: string | null) => Promise<T>): Promise<T> {
  const client = await database.pool.connect();
  try {
    await client.query('begin');
    const locked = await client.query<{ owner_user_id: string }>('select owner_user_id from servers where id = $1 for update', [serverId]);
    const value = await action(client, locked.rows[0]?.owner_user_id ?? null);
    await client.query('commit');
    return value;
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function inviteServerId(database: Database, inviteId: string): Promise<string | null> {
  const located = await database.pool.query<{ server_id: string }>('select server_id from server_invites where id = $1', [inviteId]);
  return located.rows[0]?.server_id ?? null;
}

export async function createServerInvite(database: Database, serverId: string, actorId: string, inviteeId: string): Promise<Result<ServerInviteRecord>> {
  if (actorId === inviteeId) return { denied: 'not_friend' };
  return withServerTransaction(database, serverId, async (client, ownerId) => {
    if (!ownerId) return { denied: 'not_found' };
    if (ownerId !== actorId) {
      const member = await client.query('select 1 from server_members where server_id = $1 and user_id = $2', [serverId, actorId]);
      return { denied: member.rowCount ? 'not_owner' : 'not_found' };
    }
    const member = await client.query('select 1 from server_members where server_id = $1 and user_id = $2', [serverId, inviteeId]);
    if (member.rowCount) return { denied: 'member' };
    const [low, high] = actorId < inviteeId ? [actorId, inviteeId] : [inviteeId, actorId];
    const friend = await client.query(
      `select 1 from friendships f
       join users u on u.id = $3 and u.disabled_at is null
       where f.user_low_id = $1 and f.user_high_id = $2
         and not exists (select 1 from blocks b where
           (b.blocker_id = $3 and b.blocked_id = $4) or
           (b.blocker_id = $4 and b.blocked_id = $3))
       for share of f, u`,
      [low, high, inviteeId, actorId]
    );
    if (!friend.rowCount) return { denied: 'not_friend' };
    const inserted = await client.query<{ id: string }>(
      `insert into server_invites (server_id, inviter_user_id, invitee_user_id)
       values ($1, $2, $3)
       on conflict (server_id, invitee_user_id) where status = 'pending' do nothing
       returning id`,
      [serverId, actorId, inviteeId]
    );
    const id = inserted.rows[0]?.id;
    if (!id) return { denied: 'pending' };
    const result = await client.query(`${inviteProjection} where i.id = $1`, [id]);
    if (!result.rows[0]) throw new Error('Created server invite not found.');
    return { value: record(result.rows[0]) };
  });
}

export async function listReceivedServerInvites(database: Database, actorId: string): Promise<ServerInviteRecord[]> {
  const result = await database.pool.query(
    `${inviteProjection} where i.invitee_user_id = $1 and i.status = 'pending' order by i.created_at desc, i.id desc`,
    [actorId]
  );
  return result.rows.map(record);
}

export async function listOwnedServerInvites(database: Database, serverId: string, actorId: string): Promise<Result<ServerInviteRecord[]>> {
  const server = await database.pool.query<{ owner_user_id: string }>('select owner_user_id from servers where id = $1', [serverId]);
  if (!server.rows[0]) return { denied: 'not_found' };
  if (server.rows[0].owner_user_id !== actorId) return { denied: 'not_found' };
  const result = await database.pool.query(
    `${inviteProjection} where i.server_id = $1 and i.status = 'pending' order by i.created_at, i.id`,
    [serverId]
  );
  return { value: result.rows.map(record) };
}

export async function listServerMembers(database: Database, serverId: string, actorId: string): Promise<Result<Array<{ id: string; username: string; displayName: string; avatarUrl: string | null; owner: boolean }>>> {
  const rows = await database.pool.query(
    `select u.id, u.username, u.display_name, u.avatar_url, s.owner_user_id
       from server_members m join users u on u.id = m.user_id join servers s on s.id = m.server_id
      where m.server_id = $1
        and exists (select 1 from server_members mine where mine.server_id = m.server_id and mine.user_id = $2)
      order by (u.id = s.owner_user_id) desc, lower(u.display_name), u.id`, [serverId, actorId]
  );
  if (!rows.rowCount) return { denied: 'not_found' };
  return { value: rows.rows.map((row) => ({ id: row.id, username: row.username, displayName: row.display_name, avatarUrl: normalizeLegacyAvatarUrl(row.avatar_url), owner: row.id === row.owner_user_id })) };
}

export async function acceptServerInvite(database: Database, inviteId: string, actorId: string): Promise<Result<string>> {
  const serverId = await inviteServerId(database, inviteId);
  if (!serverId) return { denied: 'not_found' };
  return withServerTransaction(database, serverId, async (client, ownerId) => {
    if (!ownerId) return { denied: 'not_found' };
    const locked = await client.query<{ invitee_user_id: string; status: string }>(
      'select invitee_user_id, status from server_invites where id = $1 and server_id = $2 for update', [inviteId, serverId]
    );
    const invite = locked.rows[0];
    if (!invite || invite.invitee_user_id !== actorId || invite.status !== 'pending') return { denied: 'not_found' };
    const member = await client.query('select 1 from server_members where server_id = $1 and user_id = $2', [serverId, actorId]);
    if (member.rowCount) return { denied: 'member' };
    await client.query('insert into server_members (server_id, user_id) values ($1, $2)', [serverId, actorId]);
    const updated = await client.query(
      "update server_invites set status = 'accepted', responded_at = now() where id = $1 and status = 'pending' returning id", [inviteId]
    );
    if (updated.rowCount !== 1) throw new Error('Pending server invite transition failed.');
    return { value: serverId };
  });
}

export async function cancelServerInvite(database: Database, inviteId: string, actorId: string): Promise<Result<string>> {
  const serverId = await inviteServerId(database, inviteId);
  if (!serverId) return { denied: 'not_found' };
  return withServerTransaction(database, serverId, async (client, ownerId) => {
    if (!ownerId || ownerId !== actorId) return { denied: 'not_found' };
    const locked = await client.query<{ status: string }>(
      'select status from server_invites where id = $1 and server_id = $2 for update', [inviteId, serverId]
    );
    if (locked.rows[0]?.status !== 'pending') return { denied: 'not_found' };
    const updated = await client.query(
      "update server_invites set status = 'cancelled', responded_at = now() where id = $1 and status = 'pending' returning id", [inviteId]
    );
    if (updated.rowCount !== 1) throw new Error('Pending server invite transition failed.');
    return { value: serverId };
  });
}

async function removeMembershipAndListChannels(client: PoolClient, serverId: string, userId: string): Promise<string[] | null> {
  const deleted = await client.query('delete from server_members where server_id = $1 and user_id = $2 returning user_id', [serverId, userId]);
  if (!deleted.rowCount) return null;
  const channels = await client.query<{ conversation_id: string }>(
    'select conversation_id from server_text_channels where server_id = $1 order by created_at, id', [serverId]
  );
  return channels.rows.map((row) => row.conversation_id);
}

export async function leaveServer(database: Database, serverId: string, actorId: string): Promise<Result<string[]>> {
  return withServerTransaction(database, serverId, async (client, ownerId) => {
    if (!ownerId) return { denied: 'not_found' };
    if (ownerId === actorId) return { denied: 'owner' };
    const channels = await removeMembershipAndListChannels(client, serverId, actorId);
    return channels ? { value: channels } : { denied: 'not_found' };
  });
}

export async function removeServerMember(database: Database, serverId: string, actorId: string, targetUserId: string): Promise<Result<string[]>> {
  return withServerTransaction(database, serverId, async (client, ownerId) => {
    if (!ownerId) return { denied: 'not_found' };
    if (ownerId !== actorId) {
      const member = await client.query('select 1 from server_members where server_id = $1 and user_id = $2', [serverId, actorId]);
      return { denied: member.rowCount ? 'not_owner' : 'not_found' };
    }
    if (ownerId === targetUserId) return { denied: 'owner' };
    const channels = await removeMembershipAndListChannels(client, serverId, targetUserId);
    return channels ? { value: channels } : { denied: 'not_found' };
  });
}
