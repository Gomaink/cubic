import type { Database } from '@cubic/database';
import type { PoolClient } from 'pg';
import type { ServerRole } from '@cubic/shared';
import { serverPermissionNames } from '../authorization/server-permissions.js';
import { canActOnServerMember, getEffectiveServerPermissions, hasServerPermission, serverPermissionMask } from '../authorization/server-permissions.js';

type Denied = { denied: 'not_found' | 'forbidden' | 'invalid_role' | 'invalid_member' };
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

async function withRoleTransaction<T>(database: Database, serverId: string, actorId: string, action: (client: PoolClient, authority: NonNullable<Awaited<ReturnType<typeof getEffectiveServerPermissions>>>) => Promise<Result<T>>): Promise<Result<T>> {
  const client = await database.pool.connect();
  try {
    await client.query('begin');
    const server = await client.query('select 1 from servers where id = $1 for update', [serverId]);
    if (!server.rows[0]) { await client.query('commit'); return { denied: 'not_found' }; }
    const authority = await getEffectiveServerPermissions(client, serverId, actorId);
    if (!authority) { await client.query('commit'); return { denied: 'not_found' }; }
    if (!hasServerPermission(authority, 'MANAGE_ROLES')) { await client.query('commit'); return { denied: 'forbidden' }; }
    const result = await action(client, authority);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function createCustomRole(database: Database, serverId: string, actorId: string, name: string, permissions: readonly unknown[] = []): Promise<Result<ServerRole>> {
  const cleanName = name.trim();
  const mask = serverPermissionMask(permissions);
  if (!cleanName || cleanName.length > 64 || mask === null) return { denied: 'invalid_role' };
  return withRoleTransaction(database, serverId, actorId, async (client, actor) => {
    // New roles occupy the highest position. A non-owner cannot create one above themselves.
    if (!actor.isOwner) return { denied: 'forbidden' };
    const inserted = await client.query(
      `insert into server_roles (server_id, name, position, permissions)
       select $1, $2, coalesce(max(position), 0) + 1, $3::bigint from server_roles where server_id = $1
       returning id, server_id, name, position, is_default, permissions`, [serverId, cleanName, mask.toString()]
    );
    return { value: role(inserted.rows[0]) };
  });
}

export async function assignCustomRole(database: Database, serverId: string, actorId: string, memberId: string, roleId: string): Promise<Result<boolean>> {
  return withRoleTransaction(database, serverId, actorId, async (client, actor) => {
    const targetMember = await getEffectiveServerPermissions(client, serverId, memberId);
    if (!targetMember) return { denied: 'invalid_member' };
    const target = await client.query<{ position: number; permissions: string }>('select position, permissions::text from server_roles where server_id = $1 and id = $2 and not is_default', [serverId, roleId]);
    if (!target.rows[0]) return { denied: 'invalid_role' };
    serverPermissionNames(BigInt(target.rows[0].permissions)); // A corrupted stored mask cannot be assigned, even by the owner.
    if (!canActOnServerMember(actor, targetMember, 'MANAGE_ROLES') || (!actor.isOwner && (target.rows[0].position >= actor.highestRolePosition || (BigInt(target.rows[0].permissions) & ~actor.effectivePermissions) !== 0n))) return { denied: 'forbidden' };
    const inserted = await client.query(
      `insert into server_member_roles (server_id, user_id, role_id) values ($1, $2, $3)
       on conflict (server_id, user_id, role_id) do nothing returning role_id`, [serverId, memberId, roleId]
    );
    return { value: Boolean(inserted.rowCount) };
  });
}

export async function deleteCustomRole(database: Database, serverId: string, actorId: string, roleId: string): Promise<Result<boolean>> {
  return withRoleTransaction(database, serverId, actorId, async (client, actor) => {
    const target = await client.query<{ position: number }>('select position from server_roles where server_id = $1 and id = $2 and not is_default', [serverId, roleId]);
    if (!target.rows[0]) return { denied: 'invalid_role' };
    if (!actor.isOwner && target.rows[0].position >= actor.highestRolePosition) return { denied: 'forbidden' };
    const deleted = await client.query('delete from server_roles where server_id = $1 and id = $2 and not is_default returning id', [serverId, roleId]);
    return deleted.rowCount ? { value: true } : { denied: 'invalid_role' };
  });
}

export async function updateServerRole(database: Database, serverId: string, actorId: string, roleId: string, patch: { name?: string | undefined; permissions?: readonly unknown[] | undefined }): Promise<Result<ServerRole>> {
  const name = patch.name?.trim();
  const mask = patch.permissions === undefined ? undefined : serverPermissionMask(patch.permissions);
  if ((name !== undefined && (!name || name.length > 64)) || mask === null || (name === undefined && mask === undefined)) return { denied: 'invalid_role' };
  return withRoleTransaction(database, serverId, actorId, async (client, actor) => {
    const found = await client.query<{ position: number; is_default: boolean; permissions: string }>('select position, is_default, permissions::text from server_roles where server_id = $1 and id = $2', [serverId, roleId]);
    const target = found.rows[0];
    if (!target) return { denied: 'invalid_role' };
    if (target.is_default && name !== undefined) return { denied: 'invalid_role' };
    if (!actor.isOwner) {
      if (target.is_default || target.position >= actor.highestRolePosition) return { denied: 'forbidden' };
      if (mask !== undefined && (mask & ~actor.effectivePermissions) !== 0n) return { denied: 'forbidden' };
      if (mask !== undefined) {
        const assigned = await client.query('select 1 from server_member_roles where server_id = $1 and user_id = $2 and role_id = $3', [serverId, actorId, roleId]);
        if (assigned.rowCount) return { denied: 'forbidden' };
      }
    }
    const updated = await client.query(
      `update server_roles set name = coalesce($3, name), permissions = coalesce($4::bigint, permissions), updated_at = now()
        where server_id = $1 and id = $2 returning id, server_id, name, position, is_default, permissions`,
      [serverId, roleId, name ?? null, mask?.toString() ?? null]
    );
    return { value: role(updated.rows[0]) };
  });
}

export async function removeCustomRoleAssignment(database: Database, serverId: string, actorId: string, memberId: string, roleId: string): Promise<Result<boolean>> {
  return withRoleTransaction(database, serverId, actorId, async (client, actor) => {
    const targetMember = await getEffectiveServerPermissions(client, serverId, memberId);
    if (!targetMember) return { denied: 'invalid_member' };
    const target = await client.query<{ position: number }>('select position from server_roles where server_id = $1 and id = $2 and not is_default', [serverId, roleId]);
    if (!target.rows[0]) return { denied: 'invalid_role' };
    if (!canActOnServerMember(actor, targetMember, 'MANAGE_ROLES') || (!actor.isOwner && target.rows[0].position >= actor.highestRolePosition)) return { denied: 'forbidden' };
    const removed = await client.query('delete from server_member_roles where server_id = $1 and user_id = $2 and role_id = $3 returning role_id', [serverId, memberId, roleId]);
    return { value: Boolean(removed.rowCount) };
  });
}
