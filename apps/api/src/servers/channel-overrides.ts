import type { Database } from '@cubic/database';
import { SERVER_PERMISSION_BITS } from '@cubic/shared';
import { withChannelManagementLock } from './layout.js';

export const CHANNEL_OVERRIDE_PERMISSIONS = [
  'VIEW_CHANNEL', 'SEND_MESSAGES', 'MANAGE_MESSAGES', 'CONNECT', 'SPEAK', 'VIDEO', 'SCREEN_SHARE'
] as const;
export type ChannelOverridePermission = typeof CHANNEL_OVERRIDE_PERMISSIONS[number];
export type OverrideTargetType = 'role' | 'member';
export type OverrideKind = 'text' | 'voice';

const allowedMask = CHANNEL_OVERRIDE_PERMISSIONS.reduce((mask, name) => mask | (1n << BigInt(SERVER_PERMISSION_BITS[name])), 0n);
function names(maskValue: string): ChannelOverridePermission[] {
  if (!/^\d+$/u.test(maskValue)) throw new Error('Invalid channel override mask.');
  const mask = BigInt(maskValue);
  if ((mask & ~allowedMask) !== 0n) throw new Error('Invalid channel override mask.');
  return CHANNEL_OVERRIDE_PERMISSIONS.filter((name) => (mask & (1n << BigInt(SERVER_PERMISSION_BITS[name]))) !== 0n);
}
function mask(permissions: readonly ChannelOverridePermission[]): string {
  return permissions.reduce((bits, name) => bits | (1n << BigInt(SERVER_PERMISSION_BITS[name])), 0n).toString();
}
const channelTable = (kind: OverrideKind) => kind === 'text' ? 'server_text_channels' : 'server_voice_channels';
const channelColumn = (kind: OverrideKind) => kind === 'text' ? 'text_channel_id' : 'voice_channel_id';
const targetColumn = (type: OverrideTargetType) => type === 'role' ? 'role_id' : 'member_user_id';

export async function listChannelOverrides(database: Database, serverId: string, actorId: string, kind: OverrideKind, channelId: string) {
  return withChannelManagementLock(database, serverId, actorId, async (client) => {
    const channel = await client.query(`select 1 from ${channelTable(kind)} where server_id = $1 and id = $2`, [serverId, channelId]);
    if (!channel.rowCount) return { denied: 'not_found' as const };
    const roles = await client.query<{ id: string; name: string; is_default: boolean }>(
      `select id, name, is_default from server_roles where server_id = $1 order by is_default desc, position, id`, [serverId]);
    const members = await client.query<{ id: string; name: string }>(
      `select m.user_id as id, u.display_name as name from server_members m join users u on u.id = m.user_id
        join servers s on s.id = m.server_id where m.server_id = $1 and m.user_id <> s.owner_user_id
        order by u.display_name, m.user_id`, [serverId]);
    const overrides = await client.query<{ role_id: string | null; member_user_id: string | null; allow: string; deny: string }>(
      `select role_id, member_user_id, allow::text, deny::text from server_channel_overrides
        where server_id = $1 and ${channelColumn(kind)} = $2 order by role_id nulls last, member_user_id`, [serverId, channelId]);
    return {
      permissions: [...CHANNEL_OVERRIDE_PERMISSIONS],
      availableRoles: roles.rows.map((row) => ({ id: row.id, name: row.is_default ? '@everyone' : row.name, isDefault: row.is_default })),
      availableMembers: members.rows,
      overrides: overrides.rows.map((row) => {
        const targetType = row.role_id ? 'role' as const : 'member' as const;
        const targetId = (row.role_id ?? row.member_user_id)!;
        const targetName = targetType === 'role' ? roles.rows.find((role) => role.id === targetId)?.name : members.rows.find((member) => member.id === targetId)?.name;
        if (!targetName) throw new Error('Channel override target missing.');
        return { targetType, targetId, targetName: targetType === 'role' && targetId === serverId ? '@everyone' : targetName,
          allow: names(row.allow), deny: names(row.deny) };
      })
    };
  });
}

export async function writeChannelOverride(database: Database, serverId: string, actorId: string, kind: OverrideKind,
  channelId: string, targetType: OverrideTargetType, targetId: string,
  permissions: { allow: ChannelOverridePermission[]; deny: ChannelOverridePermission[] } | null) {
  return withChannelManagementLock(database, serverId, actorId, async (client) => {
    const channel = await client.query(`select 1 from ${channelTable(kind)} where server_id = $1 and id = $2`, [serverId, channelId]);
    if (!channel.rowCount) return { denied: 'not_found' as const };
    const target = targetType === 'role'
      ? await client.query(`select 1 from server_roles where server_id = $1 and id = $2`, [serverId, targetId])
      : await client.query(`select 1 from server_members m join servers s on s.id = m.server_id
           where m.server_id = $1 and m.user_id = $2 and m.user_id <> s.owner_user_id`, [serverId, targetId]);
    if (!target.rowCount) return { denied: 'not_found' as const };
    const where = `server_id = $1 and ${channelColumn(kind)} = $2 and ${targetColumn(targetType)} = $3`;
    if (!permissions || (!permissions.allow.length && !permissions.deny.length)) {
      await client.query(`delete from server_channel_overrides where ${where}`, [serverId, channelId, targetId]);
      return { removed: true };
    }
    const allow = mask(permissions.allow);
    const deny = mask(permissions.deny);
    const updated = await client.query(`update server_channel_overrides set allow = $4::bigint, deny = $5::bigint
      where ${where} returning id`, [serverId, channelId, targetId, allow, deny]);
    if (!updated.rowCount) await client.query(`insert into server_channel_overrides
      (server_id, ${channelColumn(kind)}, ${targetColumn(targetType)}, allow, deny) values ($1, $2, $3, $4::bigint, $5::bigint)`,
      [serverId, channelId, targetId, allow, deny]);
    return { targetType, targetId, allow: permissions.allow, deny: permissions.deny };
  });
}
