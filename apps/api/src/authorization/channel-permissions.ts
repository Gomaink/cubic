import { SERVER_PERMISSION_BITS, parseServerPermissionName, type ServerPermissionName } from '@cubic/shared';
import { ALL_SERVER_PERMISSIONS, getEffectiveServerPermissions, serverPermissionNames, type ServerPermissionExecutor } from './server-permissions.js';

export type ChannelKind = 'text' | 'voice';
export const VOICE_CHANNEL_OVERRIDE_MASK = ['VIEW_CHANNEL', 'SEND_MESSAGES', 'MANAGE_MESSAGES', 'CONNECT', 'SPEAK', 'VIDEO', 'SCREEN_SHARE']
  .reduce((mask, name) => mask | (1n << BigInt(SERVER_PERMISSION_BITS[name as ServerPermissionName])), 0n);
export const CHANNEL_OVERRIDE_MASK = VOICE_CHANNEL_OVERRIDE_MASK | ['MENTION_EVERYONE', 'MENTION_HERE', 'MENTION_ROLES']
  .reduce((mask, name) => mask | (1n << BigInt(SERVER_PERMISSION_BITS[name as ServerPermissionName])), 0n);

interface OverrideRow {
  channel_id: string;
  role_id: string | null;
  member_user_id: string | null;
  allow_mask: string | null;
  deny_mask: string | null;
}

function checkedMask(value: string | null, allowedMask: bigint): bigint {
  if (value === null) return 0n;
  if (!/^\d+$/u.test(value)) throw new Error('Invalid channel override mask.');
  const mask = BigInt(value);
  if ((mask & ~allowedMask) !== 0n) throw new Error('Unknown channel override bits.');
  return mask;
}

export function resolveChannelPermissionMask(base: bigint, serverId: string, userId: string, rows: readonly OverrideRow[], isOwner = false, kind: ChannelKind = 'text'): bigint {
  if (isOwner) return ALL_SERVER_PERMISSIONS;
  const allowedMask = kind === 'text' ? CHANNEL_OVERRIDE_MASK : VOICE_CHANNEL_OVERRIDE_MASK;
  let defaultAllow = 0n, defaultDeny = 0n, roleAllow = 0n, roleDeny = 0n, memberAllow = 0n, memberDeny = 0n;
  for (const row of rows) {
    const allow = checkedMask(row.allow_mask, allowedMask), deny = checkedMask(row.deny_mask, allowedMask);
    if ((allow & deny) !== 0n) throw new Error('Overlapping channel override masks.');
    if (row.member_user_id === userId) { memberAllow |= allow; memberDeny |= deny; }
    else if (row.role_id === serverId) { defaultAllow |= allow; defaultDeny |= deny; }
    else if (row.role_id) { roleAllow |= allow; roleDeny |= deny; }
  }
  let result = (base & ~defaultDeny) | defaultAllow;
  result = (result & ~roleDeny) | roleAllow;
  result = (result & ~memberDeny) | memberAllow;
  return result;
}

// Two queries for any number of channels: server authority, then channel rows
// with only the default, assigned-role, and member overrides for this user.
export async function getEffectiveChannelPermissionsBatch(
  executor: ServerPermissionExecutor, serverId: string, userId: string, kind: ChannelKind, channelIds: string[]
): Promise<Map<string, bigint> | null> {
  const authority = await getEffectiveServerPermissions(executor, serverId, userId);
  if (!authority) return null;
  if (channelIds.length === 0) return new Map();
  const channelTable = kind === 'text' ? 'server_text_channels' : 'server_voice_channels';
  const overrideColumn = kind === 'text' ? 'text_channel_id' : 'voice_channel_id';
  const result = await executor.query<OverrideRow>(
    `select channel.id as channel_id, o.role_id, o.member_user_id,
            o.allow::text as allow_mask, o.deny::text as deny_mask
       from ${channelTable} channel
       left join server_channel_overrides o on o.server_id = channel.server_id
        and o.${overrideColumn} = channel.id
        and (o.role_id = channel.server_id or o.member_user_id = $2
          or exists (select 1 from server_member_roles assignment
             where assignment.server_id = channel.server_id and assignment.user_id = $2 and assignment.role_id = o.role_id))
      where channel.server_id = $1 and channel.id = any($3::uuid[])
      order by channel.id, o.id`,
    [serverId, userId, channelIds]
  );
  const grouped = new Map<string, OverrideRow[]>();
  for (const row of result.rows) {
    const rows = grouped.get(row.channel_id) ?? [];
    rows.push(row);
    grouped.set(row.channel_id, rows);
  }
  return new Map([...grouped].map(([id, rows]) =>
    [id, resolveChannelPermissionMask(authority.effectivePermissions, serverId, userId, rows, authority.isOwner, kind)]));
}

export async function getEffectiveChannelPermissions(
  executor: ServerPermissionExecutor, serverId: string, userId: string, kind: ChannelKind, channelId: string
): Promise<bigint | null> {
  return (await getEffectiveChannelPermissionsBatch(executor, serverId, userId, kind, [channelId]))?.get(channelId) ?? null;
}

export function hasChannelPermission(mask: bigint, permission: unknown): boolean {
  const name = parseServerPermissionName(permission);
  if (name === null) return false;
  const bit = 1n << BigInt(SERVER_PERMISSION_BITS[name]);
  return (CHANNEL_OVERRIDE_MASK & bit) !== 0n && (mask & bit) !== 0n;
}

export function channelPermissionNames(mask: bigint): ServerPermissionName[] {
  return serverPermissionNames(mask);
}

export async function requireChannelPermission(
  executor: ServerPermissionExecutor, serverId: string, userId: string, kind: ChannelKind, channelId: string, permission: unknown
): Promise<bigint | null> {
  const mask = await getEffectiveChannelPermissions(executor, serverId, userId, kind, channelId);
  if (mask === null || !hasChannelPermission(mask, 'VIEW_CHANNEL') || !hasChannelPermission(mask, permission)) return null;
  return mask;
}
