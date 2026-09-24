import type { Database } from '@cubic/database';
import { createHash } from 'node:crypto';

export interface ServerRecord {
  id: string;
  name: string;
  iconUrl: string | null;
  ownerUserId: string;
  createdAt: string;
  updatedAt: string;
}

function serverRecord(row: {
  id: string;
  name: string;
  icon_key: string | null;
  owner_user_id: string;
  created_at: Date;
  updated_at: Date;
}): ServerRecord {
  return {
    id: row.id,
    name: row.name,
    iconUrl: row.icon_key ? `/api/v1/servers/${row.id}/icon?v=${createHash('sha256').update(row.icon_key).digest('hex').slice(0, 16)}` : null,
    ownerUserId: row.owner_user_id,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  };
}

export async function createOwnedServer(database: Database, ownerUserId: string, name: string): Promise<ServerRecord> {
  const client = await database.pool.connect();
  try {
    await client.query('begin');
    const inserted = await client.query(
      `insert into servers (name, owner_user_id)
       values ($1, $2)
       returning id, name, icon_key, owner_user_id, created_at, updated_at`,
      [name, ownerUserId]
    );
    const server = inserted.rows[0];
    if (!server) throw new Error('Server insert returned no row.');
    await client.query(
      'insert into server_members (server_id, user_id) values ($1, $2)',
      [server.id, ownerUserId]
    );
    await client.query('commit');
    return serverRecord(server);
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function listMemberServers(database: Database, userId: string): Promise<ServerRecord[]> {
  const result = await database.pool.query(
    `select s.id, s.name, s.icon_key, s.owner_user_id, s.created_at, s.updated_at
       from server_members member
       join servers s on s.id = member.server_id
      where member.user_id = $1
      order by s.created_at desc, s.id desc`,
    [userId]
  );
  return result.rows.map(serverRecord);
}

export async function resolveMemberServer(database: Database, serverId: string, userId: string): Promise<ServerRecord | null> {
  const result = await database.pool.query(
    `select s.id, s.name, s.icon_key, s.owner_user_id, s.created_at, s.updated_at
       from servers s
       join server_members member on member.server_id = s.id and member.user_id = $2
      where s.id = $1
      limit 1`,
    [serverId, userId]
  );
  return result.rows[0] ? serverRecord(result.rows[0]) : null;
}
