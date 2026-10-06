import type { Database } from '@cubic/database';
import { compactLayoutScope, withChannelManagementLock } from './layout.js';
import { getEffectiveChannelPermissionsBatch, hasChannelPermission } from '../authorization/channel-permissions.js';

export interface ServerVoiceChannelRecord {
  id: string;
  serverId: string;
  categoryId: string | null;
  name: string;
  position: number;
  createdAt: string;
  updatedAt: string;
}

interface Row {
  id: string;
  server_id: string;
  category_id: string | null;
  name: string;
  position: number;
  created_at: Date;
  updated_at: Date;
}

function record(row: Row): ServerVoiceChannelRecord {
  return {
    id: row.id, serverId: row.server_id, categoryId: row.category_id,
    name: row.name, position: row.position,
    createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString()
  };
}

export async function listMemberVoiceChannels(database: Database, serverId: string, actorId: string) {
  const result = await database.pool.query<Row>(
    `select voice.id, voice.server_id, voice.category_id, voice.name, voice.position,
            voice.created_at, voice.updated_at
       from server_voice_channels voice
       join server_members member on member.server_id = voice.server_id and member.user_id = $2
       left join server_channel_categories category
         on category.id = voice.category_id and category.server_id = voice.server_id
      where voice.server_id = $1 and (voice.category_id is null or category.id is not null)
      order by voice.position, voice.created_at, voice.id`,
    [serverId, actorId]
  );
  const permissions = await getEffectiveChannelPermissionsBatch(database.pool, serverId, actorId, 'voice', result.rows.map((row) => row.id));
  if (!permissions) return [];
  return result.rows.filter((row) => {
    const mask = permissions.get(row.id);
    return mask !== undefined && hasChannelPermission(mask, 'VIEW_CHANNEL');
  }).map(record);
}

export async function createVoiceChannel(database: Database, serverId: string, actorId: string, name: string, categoryId: string | null) {
  return withChannelManagementLock(database, serverId, actorId, async (client) => {
    if (categoryId) {
      const category = await client.query(
        `select 1 from server_channel_categories where id = $1 and server_id = $2`, [categoryId, serverId]
      );
      if (!category.rowCount) return { denied: 'not_found' as const };
    }
    const position = await compactLayoutScope(client, serverId, categoryId);
    const inserted = await client.query<Row>(
      `insert into server_voice_channels(server_id, category_id, name, position)
       values($1, $2, $3, $4)
       returning id, server_id, category_id, name, position, created_at, updated_at`,
      [serverId, categoryId, name, position]
    );
    return { channel: record(inserted.rows[0]!) };
  });
}

export async function renameVoiceChannel(database: Database, serverId: string, actorId: string, channelId: string, name: string) {
  return withChannelManagementLock(database, serverId, actorId, async (client) => {
    const updated = await client.query<Row>(
      `update server_voice_channels set name = $3, updated_at = now()
        where id = $2 and server_id = $1
          and (category_id is null or exists (
            select 1 from server_channel_categories where id = category_id and server_id = $1
          ))
       returning id, server_id, category_id, name, position, created_at, updated_at`,
      [serverId, channelId, name]
    );
    return updated.rows[0] ? { channel: record(updated.rows[0]) } : { denied: 'not_found' as const };
  });
}

export async function deleteVoiceChannel(database: Database, serverId: string, actorId: string, channelId: string) {
  return withChannelManagementLock(database, serverId, actorId, async (client) => {
    const found = await client.query<{ category_id: string | null }>(
      'select category_id from server_voice_channels where server_id = $1 and id = $2', [serverId, channelId]
    );
    if (!found.rows[0]) return { denied: 'not_found' as const };
    if (found.rows[0].category_id) {
      const category = await client.query('select 1 from server_channel_categories where id = $1 and server_id = $2', [found.rows[0].category_id, serverId]);
      if (!category.rowCount) return { denied: 'not_found' as const };
    }
    const deleted = await client.query<{ category_id: string | null }>(
      `delete from server_voice_channels where server_id = $1 and id = $2 returning category_id`,
      [serverId, channelId]
    );
    if (!deleted.rows[0]) return { denied: 'not_found' as const };
    await compactLayoutScope(client, serverId, deleted.rows[0].category_id);
    return { deleted: true };
  });
}
