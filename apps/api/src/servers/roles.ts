import type { Database } from '@cubic/database';
import type { PoolClient } from 'pg';
import type { ServerRole } from '@cubic/shared';
import { serverPermissionNames } from '../authorization/server-permissions.js';

type Denied = { denied: 'not_found' | 'not_owner' | 'invalid_role' | 'invalid_member' };
type Result<T> = { value: T } | Denied;

function role(row: any): ServerRole {
  return { id: row.id, serverId: row.server_id, name: row.name, position: row.position, isDefault: row.is_default,
    permissions: serverPermissionNames(BigInt(row.permissions)) };
}

export async function listServerRoles(database: Database, serverId: string, actorId: string): Promise<Result<ServerRole[]>> {
  const result = await database.pool.query(
    `select r.id, r.server_id, r.name, r.position, r.is_default, r.permissions
       from server_members actor join server_roles r on r.server_id = actor.server_id
      where actor.server_id = $1 and actor.user_id = $2
      order by r.position desc, r.id`, [serverId, actorId]
  );
  if (!result.rowCount) return { denied: 'not_found' };
  return { value: result.rows.map(role) };
}

export async function listMemberRoles(database: Database, serverId: string, actorId: string, memberId: string): Promise<Result<ServerRole[]>> {
  const result = await database.pool.query(
    `select r.id, r.server_id, r.name, r.position, r.is_default, r.permissions
       from server_members actor
       join server_members member on member.server_id = actor.server_id and member.user_id = $3
       join server_roles r on r.server_id = actor.server_id
       left join server_member_roles assignment on assignment.server_id = member.server_id
         and assignment.user_id = member.user_id and assignment.role_id = r.id
      where actor.server_id = $1 and actor.user_id = $2 and (r.is_default or assignment.role_id is not null)
      order by r.position desc, r.id`, [serverId, actorId, memberId]
  );
  if (!result.rowCount) return { denied: 'not_found' };
  return { value: result.rows.map(role) };
}

async function withOwnerTransaction<T>(database: Database, serverId: string, actorId: string, action: (client: PoolClient) => Promise<Result<T>>): Promise<Result<T>> {
  const client = await database.pool.connect();
  try {
    await client.query('begin');
    const server = await client.query<{ owner_user_id: string }>('select owner_user_id from servers where id = $1 for update', [serverId]);
    if (!server.rows[0]) { await client.query('commit'); return { denied: 'not_found' }; }
    if (server.rows[0].owner_user_id !== actorId) { await client.query('commit'); return { denied: 'not_owner' }; }
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

// Domain operations for later slices. No public mutation route is exposed in 12.1.
export async function createCustomRole(database: Database, serverId: string, actorId: string, name: string): Promise<Result<ServerRole>> {
  const cleanName = name.trim();
  if (!cleanName || cleanName.length > 64) return { denied: 'invalid_role' };
  return withOwnerTransaction(database, serverId, actorId, async (client) => {
    const inserted = await client.query(
      `insert into server_roles (server_id, name, position)
       select $1, $2, coalesce(max(position), 0) + 1 from server_roles where server_id = $1
       returning id, server_id, name, position, is_default, permissions`, [serverId, cleanName]
    );
    return { value: role(inserted.rows[0]) };
  });
}

export async function assignCustomRole(database: Database, serverId: string, actorId: string, memberId: string, roleId: string): Promise<Result<boolean>> {
  return withOwnerTransaction(database, serverId, actorId, async (client) => {
    const member = await client.query('select 1 from server_members where server_id = $1 and user_id = $2', [serverId, memberId]);
    if (!member.rowCount) return { denied: 'invalid_member' };
    const target = await client.query('select 1 from server_roles where server_id = $1 and id = $2 and not is_default', [serverId, roleId]);
    if (!target.rowCount) return { denied: 'invalid_role' };
    const inserted = await client.query(
      `insert into server_member_roles (server_id, user_id, role_id) values ($1, $2, $3)
       on conflict (server_id, user_id, role_id) do nothing returning role_id`, [serverId, memberId, roleId]
    );
    return { value: Boolean(inserted.rowCount) };
  });
}

export async function deleteCustomRole(database: Database, serverId: string, actorId: string, roleId: string): Promise<Result<boolean>> {
  return withOwnerTransaction(database, serverId, actorId, async (client) => {
    const deleted = await client.query('delete from server_roles where server_id = $1 and id = $2 and not is_default returning id', [serverId, roleId]);
    return deleted.rowCount ? { value: true } : { denied: 'invalid_role' };
  });
}
