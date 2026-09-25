import type { Database } from '@cubic/database';
import type { PoolClient } from 'pg';

type Client = PoolClient;
type Denied = { denied: 'not_found' | 'not_owner' | 'invalid_index' };
export interface CategoryRecord {
  id: string;
  serverId: string;
  name: string;
  position: number;
  createdAt: string;
  updatedAt: string;
}

function categoryRecord(row: {
  id: string; server_id: string; name: string; position: number;
  created_at: Date; updated_at: Date;
}): CategoryRecord {
  return {
    id: row.id, serverId: row.server_id, name: row.name, position: row.position,
    createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString()
  };
}

export async function withOwnerLock<T>(
  database: Database, serverId: string, actorId: string,
  action: (client: Client) => Promise<T | Denied>
): Promise<T | Denied> {
  const client = await database.pool.connect();
  try {
    await client.query('begin');
    const authority = await client.query<{ owner_user_id: string; is_member: boolean }>(
      `select s.owner_user_id, exists (
         select 1 from server_members m where m.server_id = s.id and m.user_id = $2
       ) as is_member from servers s where s.id = $1 for update of s`,
      [serverId, actorId]
    );
    const row = authority.rows[0];
    if (!row?.is_member) { await client.query('rollback'); return { denied: 'not_found' }; }
    if (row.owner_user_id !== actorId) { await client.query('rollback'); return { denied: 'not_owner' }; }
    const result = await action(client);
    if (result && typeof result === 'object' && 'denied' in result) {
      await client.query('rollback');
    } else {
      await client.query('commit');
    }
    return result;
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function categories(client: Client, serverId: string) {
  const result = await client.query<{
    id: string; server_id: string; name: string; position: number;
    created_at: Date; updated_at: Date;
  }>(
    `select id, server_id, name, position, created_at, updated_at
       from server_channel_categories where server_id = $1
      order by position, created_at, id`, [serverId]
  );
  return result.rows;
}

export type LayoutChannel = { kind: 'text' | 'voice'; id: string };

async function channels(client: Client, serverId: string, categoryId: string | null): Promise<LayoutChannel[]> {
  const result = await client.query<LayoutChannel>(
    `select kind, id from (
       select 'text'::text as kind, id, position, created_at from server_text_channels
        where server_id = $1 and category_id is not distinct from $2::uuid
       union all
       select 'voice'::text as kind, id, position, created_at from server_voice_channels
        where server_id = $1 and category_id is not distinct from $2::uuid
     ) layout order by position, created_at, id, kind`, [serverId, categoryId]
  );
  return result.rows;
}

async function compactCategories(client: Client, ids: string[]) {
  for (let position = 0; position < ids.length; position += 1) {
    await client.query(
      `update server_channel_categories set position = $2, updated_at = now() where id = $1`,
      [ids[position], position]
    );
  }
}

async function compactChannels(client: Client, ids: LayoutChannel[], categoryId: string | null) {
  for (let position = 0; position < ids.length; position += 1) {
    const channel = ids[position]!;
    await client.query(
      `update ${channel.kind === 'text' ? 'server_text_channels' : 'server_voice_channels'}
          set category_id = $2, position = $3, updated_at = now() where id = $1`,
      [channel.id, categoryId, position]
    );
  }
}

export async function compactLayoutScope(client: Client, serverId: string, categoryId: string | null): Promise<number> {
  const ordered = await channels(client, serverId, categoryId);
  await compactChannels(client, ordered, categoryId);
  return ordered.length;
}

export async function listMemberCategories(database: Database, serverId: string, actorId: string): Promise<CategoryRecord[] | Denied> {
  const member = await database.pool.query(
    `select 1 from server_members where server_id = $1 and user_id = $2`, [serverId, actorId]
  );
  if (!member.rowCount) return { denied: 'not_found' };
  const client = await database.pool.connect();
  try { return (await categories(client, serverId)).map(categoryRecord); }
  finally { client.release(); }
}

export async function createCategory(database: Database, serverId: string, actorId: string, name: string) {
  return withOwnerLock(database, serverId, actorId, async (client) => {
    const ordered = await categories(client, serverId);
    const inserted = await client.query<Parameters<typeof categoryRecord>[0]>(
      `insert into server_channel_categories(server_id, name, position)
       values ($1, $2, $3) returning id, server_id, name, position, created_at, updated_at`,
      [serverId, name, ordered.length]
    );
    return { category: categoryRecord(inserted.rows[0]!) };
  });
}

export async function renameCategory(database: Database, serverId: string, actorId: string, categoryId: string, name: string) {
  return withOwnerLock(database, serverId, actorId, async (client) => {
    const updated = await client.query<Parameters<typeof categoryRecord>[0]>(
      `update server_channel_categories set name = $3, updated_at = now()
        where server_id = $1 and id = $2
       returning id, server_id, name, position, created_at, updated_at`,
      [serverId, categoryId, name]
    );
    return updated.rows[0] ? { category: categoryRecord(updated.rows[0]) } : { denied: 'not_found' as const };
  });
}

export async function deleteCategory(database: Database, serverId: string, actorId: string, categoryId: string) {
  return withOwnerLock(database, serverId, actorId, async (client) => {
    const ordered = await categories(client, serverId);
    if (!ordered.some((row) => row.id === categoryId)) return { denied: 'not_found' as const };
    const malformed = await client.query(
      `select 1 from (
         select server_id from server_text_channels where category_id = $1
         union all select server_id from server_voice_channels where category_id = $1
       ) assigned where server_id <> $2 limit 1`,
      [categoryId, serverId]
    );
    if (malformed.rowCount) return { denied: 'not_found' as const };
    const uncategorized = await channels(client, serverId, null);
    const contained = await channels(client, serverId, categoryId);
    await client.query(`delete from server_channel_categories where server_id = $1 and id = $2`, [serverId, categoryId]);
    await compactChannels(client, [...uncategorized, ...contained], null);
    await compactCategories(client, ordered.filter((row) => row.id !== categoryId).map((row) => row.id));
    return { deleted: true };
  });
}

export async function moveCategory(database: Database, serverId: string, actorId: string, categoryId: string, targetIndex: number) {
  return withOwnerLock(database, serverId, actorId, async (client) => {
    const ordered = (await categories(client, serverId)).map((row) => row.id);
    const current = ordered.indexOf(categoryId);
    if (current < 0) return { denied: 'not_found' as const };
    if (targetIndex < 0 || targetIndex >= ordered.length) return { denied: 'invalid_index' as const };
    ordered.splice(current, 1);
    ordered.splice(targetIndex, 0, categoryId);
    await compactCategories(client, ordered);
    return { categories: (await categories(client, serverId)).map(categoryRecord) };
  });
}

export async function moveTypedChannel(
  database: Database, serverId: string, actorId: string,
  kind: 'text' | 'voice', channelId: string, targetCategoryId: string | null, targetIndex: number
) {
  return withOwnerLock(database, serverId, actorId, async (client) => {
    const channel = await client.query<{ category_id: string | null }>(
      `select category_id from ${kind === 'text' ? 'server_text_channels' : 'server_voice_channels'}
        where id = $1 and server_id = $2`, [channelId, serverId]
    );
    if (!channel.rows[0]) return { denied: 'not_found' as const };
    const sourceCategoryId = channel.rows[0].category_id;
    if (sourceCategoryId) {
      const source = await client.query(`select 1 from server_channel_categories where id = $1 and server_id = $2`, [sourceCategoryId, serverId]);
      if (!source.rowCount) return { denied: 'not_found' as const };
    }
    if (targetCategoryId) {
      const target = await client.query(`select 1 from server_channel_categories where id = $1 and server_id = $2`, [targetCategoryId, serverId]);
      if (!target.rowCount) return { denied: 'not_found' as const };
    }
    const sourceIds = (await channels(client, serverId, sourceCategoryId)).filter((item) => item.kind !== kind || item.id !== channelId);
    const sameScope = sourceCategoryId === targetCategoryId;
    const targetIds = sameScope ? sourceIds : await channels(client, serverId, targetCategoryId);
    if (targetIndex < 0 || targetIndex > targetIds.length) return { denied: 'invalid_index' as const };
    targetIds.splice(targetIndex, 0, { kind, id: channelId });
    if (!sameScope) await compactChannels(client, sourceIds, sourceCategoryId);
    await compactChannels(client, targetIds, targetCategoryId);
    return { moved: true };
  });
}

export function moveChannel(
  database: Database, serverId: string, actorId: string,
  channelId: string, targetCategoryId: string | null, targetIndex: number
) {
  return moveTypedChannel(database, serverId, actorId, 'text', channelId, targetCategoryId, targetIndex);
}
