import type { Database } from '@cubic/database';
import { compactLayoutScope, withChannelManagementLock } from './layout.js';
import { getEffectiveChannelPermissionsBatch, hasChannelPermission } from '../authorization/channel-permissions.js';

export interface ServerTextChannelRecord {
  id: string;
  serverId: string;
  conversationId: string;
  name: string;
  categoryId: string | null;
  position: number;
  createdAt: string;
  updatedAt: string;
}

function channelRecord(row: {
  id: string;
  server_id: string;
  conversation_id: string;
  name: string;
  category_id: string | null;
  position: number;
  created_at: Date;
  updated_at: Date;
}): ServerTextChannelRecord {
  return {
    id: row.id,
    serverId: row.server_id,
    conversationId: row.conversation_id,
    name: row.name,
    categoryId: row.category_id,
    position: row.position,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  };
}

export async function createOwnedTextChannel(
  database: Database,
  serverId: string,
  actorUserId: string,
  name: string,
  categoryId: string | null = null
) {
  return withChannelManagementLock(database, serverId, actorUserId, async (client) => {
    if (categoryId) {
      const category = await client.query(
        `select 1 from server_channel_categories where id = $1 and server_id = $2`,
        [categoryId, serverId]
      );
      if (!category.rowCount) {
        return { denied: 'not_found' };
      }
    }
    const position = await compactLayoutScope(client, serverId, categoryId);

    const conversation = await client.query<{ id: string }>(
      `insert into conversations (kind, created_by)
       values ('server_text', $1)
       returning id`,
      [actorUserId]
    );
    const conversationId = conversation.rows[0]?.id;
    if (!conversationId) throw new Error('Channel conversation insert returned no row.');

    const inserted = await client.query(
      `insert into server_text_channels (server_id, conversation_id, name, category_id, position)
       values ($1, $2, $3, $4, $5)
       returning id, server_id, conversation_id, name, category_id, position, created_at, updated_at`,
      [serverId, conversationId, name, categoryId, position]
    );
    const row = inserted.rows[0];
    if (!row) throw new Error('Channel insert returned no row.');
    return { channel: channelRecord(row) };
  });
}

export async function renameTextChannel(database: Database, serverId: string, actorId: string, channelId: string, name: string) {
  return withChannelManagementLock(database, serverId, actorId, async (client) => {
    const updated = await client.query<Parameters<typeof channelRecord>[0]>(
      `update server_text_channels set name = $3, updated_at = now()
        where server_id = $1 and id = $2
          and (category_id is null or exists (
            select 1 from server_channel_categories where id = category_id and server_id = $1
          ))
       returning id, server_id, conversation_id, name, category_id, position, created_at, updated_at`,
      [serverId, channelId, name]
    );
    return updated.rows[0] ? { channel: channelRecord(updated.rows[0]) } : { denied: 'not_found' as const };
  });
}

export async function deleteTextChannel(database: Database, serverId: string, actorId: string, channelId: string) {
  return withChannelManagementLock(database, serverId, actorId, async (client) => {
    const found = await client.query<{ conversation_id: string; category_id: string | null }>(
      `select conversation_id, category_id from server_text_channels where server_id = $1 and id = $2`,
      [serverId, channelId]
    );
    const channel = found.rows[0];
    if (!channel) return { denied: 'not_found' as const };
    if (channel.category_id) {
      const category = await client.query('select 1 from server_channel_categories where id = $1 and server_id = $2', [channel.category_id, serverId]);
      if (!category.rowCount) return { denied: 'not_found' as const };
    }
    await client.query('delete from server_text_channels where server_id = $1 and id = $2', [serverId, channelId]);
    await client.query("delete from conversations where id = $1 and kind = 'server_text'", [channel.conversation_id]);
    await compactLayoutScope(client, serverId, channel.category_id);
    return { conversationId: channel.conversation_id };
  });
}

export async function listMemberTextChannels(
  database: Database,
  serverId: string,
  actorUserId: string
): Promise<ServerTextChannelRecord[]> {
  const result = await database.pool.query(
    `select channel.id, channel.server_id, channel.conversation_id,
            channel.name, channel.category_id, channel.position, channel.created_at, channel.updated_at
       from server_text_channels channel
       join conversations conversation
         on conversation.id = channel.conversation_id and conversation.kind = 'server_text'
       join server_members member
         on member.server_id = channel.server_id and member.user_id = $2
       left join server_channel_categories category
         on category.id = channel.category_id and category.server_id = channel.server_id
      where channel.server_id = $1
        and (channel.category_id is null or category.id is not null)
      order by channel.position, channel.created_at, channel.id`,
    [serverId, actorUserId]
  );
  const permissions = await getEffectiveChannelPermissionsBatch(database.pool, serverId, actorUserId, 'text', result.rows.map((row) => row.id));
  if (!permissions) return [];
  return result.rows.filter((row) => {
    const mask = permissions.get(row.id);
    return mask !== undefined && hasChannelPermission(mask, 'VIEW_CHANNEL');
  }).map(channelRecord);
}
