import type { Database } from '@cubic/database';

export interface ServerTextChannelRecord {
  id: string;
  serverId: string;
  conversationId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

function channelRecord(row: {
  id: string;
  server_id: string;
  conversation_id: string;
  name: string;
  created_at: Date;
  updated_at: Date;
}): ServerTextChannelRecord {
  return {
    id: row.id,
    serverId: row.server_id,
    conversationId: row.conversation_id,
    name: row.name,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  };
}

export async function createOwnedTextChannel(
  database: Database,
  serverId: string,
  actorUserId: string,
  name: string
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

    const conversation = await client.query<{ id: string }>(
      `insert into conversations (kind, created_by)
       values ('server_text', $1)
       returning id`,
      [actorUserId]
    );
    const conversationId = conversation.rows[0]?.id;
    if (!conversationId) throw new Error('Channel conversation insert returned no row.');

    const inserted = await client.query(
      `insert into server_text_channels (server_id, conversation_id, name)
       values ($1, $2, $3)
       returning id, server_id, conversation_id, name, created_at, updated_at`,
      [serverId, conversationId, name]
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
            channel.name, channel.created_at, channel.updated_at
       from server_text_channels channel
       join conversations conversation
         on conversation.id = channel.conversation_id and conversation.kind = 'server_text'
       join server_members member
         on member.server_id = channel.server_id and member.user_id = $2
      where channel.server_id = $1
      order by channel.created_at, channel.id`,
    [serverId, actorUserId]
  );
  return result.rows.map(channelRecord);
}
