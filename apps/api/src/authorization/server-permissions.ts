import type { PoolClient } from 'pg';
import { SERVER_PERMISSION_BITS, parseServerPermissionName, type ServerPermissionName } from '@cubic/shared';

export type ServerPermissionExecutor = Pick<PoolClient, 'query'>;

export interface ServerAuthority {
  serverId: string;
  userId: string;
  isOwner: boolean;
  effectivePermissions: bigint;
  highestRolePosition: number;
}

const entries = Object.entries(SERVER_PERMISSION_BITS) as Array<[ServerPermissionName, number]>;
export const ALL_SERVER_PERMISSIONS = entries.reduce((mask, [, bit]) => mask | (1n << BigInt(bit)), 0n);
export const DEFAULT_SERVER_PERMISSIONS = serverPermissionMask([
  'VIEW_SERVER', 'SEND_MESSAGES', 'CONNECT', 'SPEAK', 'VIDEO', 'SCREEN_SHARE', 'VIEW_CHANNEL'
])!;

export function serverPermissionMask(names: readonly unknown[]): bigint | null {
  let mask = 0n;
  for (const value of names) {
    const name = parseServerPermissionName(value);
    if (!name) return null;
    mask |= 1n << BigInt(SERVER_PERMISSION_BITS[name]);
  }
  return mask;
}

export function serverPermissionNames(mask: bigint): ServerPermissionName[] {
  if (mask < 0n || (mask & ~ALL_SERVER_PERMISSIONS) !== 0n) throw new Error('Unknown server permission bits.');
  return entries.filter(([, bit]) => (mask & (1n << BigInt(bit))) !== 0n).map(([name]) => name);
}

function parseDatabaseMask(value: unknown): bigint {
  if (typeof value !== 'string' || !/^\d+$/u.test(value)) throw new Error('Invalid server permission mask from database.');
  const mask = BigInt(value);
  serverPermissionNames(mask); // Reject unexpected bits before authorization.
  return mask;
}

// One scoped query aggregates the implicit default and all assigned custom roles.
// PostgreSQL returns bigint as text; BigInt never crosses an HTTP JSON boundary.
export async function getEffectiveServerPermissions(executor: ServerPermissionExecutor, serverId: string, userId: string): Promise<ServerAuthority | null> {
  const result = await executor.query<{
    owner_user_id: string;
    permissions_mask: string;
    highest_position: number;
  }>(
    `select s.owner_user_id,
            (d.permissions | coalesce(bit_or(r.permissions), 0))::text as permissions_mask,
            coalesce(max(r.position), 0)::integer as highest_position
       from servers s
       join server_members m on m.server_id = s.id and m.user_id = $2
       join server_roles d on d.server_id = s.id and d.is_default
       left join server_member_roles a on a.server_id = m.server_id and a.user_id = m.user_id
       left join server_roles r on r.server_id = a.server_id and r.id = a.role_id and not r.is_default
      where s.id = $1
      group by s.owner_user_id, d.permissions`,
    [serverId, userId]
  );
  const row = result.rows[0];
  if (!row) return null;
  const isOwner = row.owner_user_id === userId;
  const permissions = parseDatabaseMask(row.permissions_mask);
  return {
    serverId, userId, isOwner,
    effectivePermissions: isOwner ? ALL_SERVER_PERMISSIONS : permissions,
    highestRolePosition: row.highest_position
  };
}

export function hasServerPermission(authority: ServerAuthority, permission: unknown): boolean {
  const name = parseServerPermissionName(permission);
  return name !== null && (authority.effectivePermissions & (1n << BigInt(SERVER_PERMISSION_BITS[name]))) !== 0n;
}

export async function requireServerPermission(executor: ServerPermissionExecutor, serverId: string, userId: string, permission: unknown): Promise<
  { value: ServerAuthority } | { denied: 'not_found' | 'forbidden' }
> {
  const authority = await getEffectiveServerPermissions(executor, serverId, userId);
  if (!authority) return { denied: 'not_found' };
  return hasServerPermission(authority, permission) ? { value: authority } : { denied: 'forbidden' };
}

export function getHighestRolePosition(authority: ServerAuthority): number {
  return authority.highestRolePosition;
}

export function canActOnServerMember(actor: ServerAuthority, target: ServerAuthority, permission: unknown): boolean {
  if (actor.serverId !== target.serverId || actor.userId === target.userId || target.isOwner) return false;
  if (!hasServerPermission(actor, permission)) return false;
  return actor.isOwner || actor.highestRolePosition > target.highestRolePosition;
}
