import type { Database } from '@cubic/database';

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
): Promise<{ channel: ServerTextChannelRecord } | { denied: 'not_found' | 'not_owner' }> {
  const client = await database.pool.connect();
  try {
    await client.query('begin');
    const authority = await client.query<{ owner_user_id: string }>(
      `select s.owner_user_id
         from servers s
         join server_members member on member.server_id = s.id and member.user_id = $2
        where s.id = $1
        for update of s`,
      [serverId, actorUserId]
    );
    const ownerId = authority.rows[0]?.owner_user_id;
    if (!ownerId || ownerId !== actorUserId) {
      await client.query('rollback');
      return { denied: ownerId ? 'not_owner' : 'not_found' };
    }

    if (categoryId) {
      const category = await client.query(
        `select 1 from server_channel_categories where id = $1 and server_id = $2`,
        [categoryId, serverId]
      );
      if (!category.rowCount) {
        await client.query('rollback');
        return { denied: 'not_found' };
      }
    }
    const scope = await client.query<{ count: string }>(
      `select count(*)::text as count from server_text_channels
        where server_id = $1 and category_id is not distinct from $2::uuid`,
      [serverId, categoryId]
    );
    const position = Number(scope.rows[0]?.count ?? 0);

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
    await client.query('commit');
    return { channel: channelRecord(row) };
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
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
  return result.rows.map(channelRecord);
}
