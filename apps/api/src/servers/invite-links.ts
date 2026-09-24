import { createHash, randomBytes } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { Database } from '@cubic/database';

const LINK_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

type Denial = 'not_found' | 'not_owner' | 'unavailable';
type Result<T> = { value: T } | { denied: Denial };

export interface InviteLinkMetadata {
  id: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
}

export interface InviteLinkPreview {
  server: { id: string; name: string };
  alreadyMember?: boolean;
}

function metadata(row: any): InviteLinkMetadata {
  return {
    id: row.id,
    createdAt: new Date(row.created_at).toISOString(),
    expiresAt: new Date(row.expires_at).toISOString(),
    revokedAt: row.revoked_at ? new Date(row.revoked_at).toISOString() : null
  };
}

export function validInviteLinkToken(token: unknown): token is string {
  return typeof token === 'string' && TOKEN_PATTERN.test(token);
}

function digest(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

async function withLockedServer<T>(database: Database, serverId: string, action: (client: PoolClient, ownerId: string | null) => Promise<T>): Promise<T> {
  const client = await database.pool.connect();
  try {
    await client.query('begin');
    const locked = await client.query<{ owner_user_id: string }>('select owner_user_id from servers where id = $1 for update', [serverId]);
    const result = await action(client, locked.rows[0]?.owner_user_id ?? null);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function createServerInviteLink(database: Database, serverId: string, actorId: string): Promise<Result<{ inviteLink: InviteLinkMetadata; token: string }>> {
  return withLockedServer(database, serverId, async (client, ownerId) => {
    if (!ownerId) return { denied: 'not_found' };
    if (ownerId !== actorId) {
      const member = await client.query('select 1 from server_members where server_id = $1 and user_id = $2', [serverId, actorId]);
      return { denied: member.rowCount ? 'not_owner' : 'not_found' };
    }
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + LINK_LIFETIME_MS);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const token = randomBytes(32).toString('base64url');
      const inserted = await client.query(
        `insert into server_invite_links (server_id, creator_user_id, token_digest, created_at, expires_at)
         values ($1, $2, $3, $4, $5)
         on conflict (token_digest) do nothing
         returning id, created_at, expires_at, revoked_at`,
        [serverId, actorId, digest(token), createdAt, expiresAt]
      );
      if (inserted.rows[0]) return { value: { inviteLink: metadata(inserted.rows[0]), token } };
    }
    throw new Error('Could not create a unique server invite link.');
  });
}

export async function listOwnedServerInviteLinks(database: Database, serverId: string, actorId: string): Promise<Result<InviteLinkMetadata[]>> {
  const result = await database.pool.query(
    `select l.id, l.created_at, l.expires_at, l.revoked_at
       from server_invite_links l join servers s on s.id = l.server_id
      where l.server_id = $1 and s.owner_user_id = $2
      order by l.created_at desc, l.id desc`, [serverId, actorId]
  );
  const owner = await database.pool.query('select 1 from servers where id = $1 and owner_user_id = $2', [serverId, actorId]);
  if (!owner.rowCount) return { denied: 'not_found' };
  return { value: result.rows.map(metadata) };
}

export async function revokeServerInviteLink(database: Database, serverId: string, linkId: string, actorId: string): Promise<Result<InviteLinkMetadata>> {
  return withLockedServer(database, serverId, async (client, ownerId) => {
    if (!ownerId) return { denied: 'not_found' };
    if (ownerId !== actorId) {
      const member = await client.query('select 1 from server_members where server_id = $1 and user_id = $2', [serverId, actorId]);
      return { denied: member.rowCount ? 'not_owner' : 'not_found' };
    }
    const result = await client.query(
      `update server_invite_links set revoked_at = coalesce(revoked_at, now())
        where id = $1 and server_id = $2 returning id, created_at, expires_at, revoked_at`, [linkId, serverId]
    );
    return result.rows[0] ? { value: metadata(result.rows[0]) } : { denied: 'not_found' };
  });
}

export async function previewServerInviteLink(database: Database, token: string, actorId?: string): Promise<Result<InviteLinkPreview>> {
  const result = await database.pool.query(
    `select s.id, s.name${actorId ? ', exists (select 1 from server_members m where m.server_id = s.id and m.user_id = $2) as already_member' : ''}
       from server_invite_links l join servers s on s.id = l.server_id
      where l.token_digest = $1 and l.revoked_at is null and l.expires_at > now()`,
    actorId ? [digest(token), actorId] : [digest(token)]
  );
  const row = result.rows[0];
  if (!row) return { denied: 'unavailable' };
  return { value: { server: { id: row.id, name: row.name }, ...(actorId ? { alreadyMember: row.already_member } : {}) } };
}

export async function joinServerViaInviteLink(database: Database, token: string, actorId: string): Promise<Result<InviteLinkPreview & { joined: boolean }>> {
  const tokenDigest = digest(token);
  const candidate = await database.pool.query<{ server_id: string }>('select server_id from server_invite_links where token_digest = $1', [tokenDigest]);
  const serverId = candidate.rows[0]?.server_id;
  if (!serverId) return { denied: 'unavailable' };
  return withLockedServer(database, serverId, async (client, ownerId) => {
    if (!ownerId) return { denied: 'unavailable' };
    const link = await client.query<{ id: string; name: string }>(
      `select s.id, s.name from server_invite_links l join servers s on s.id = l.server_id
        where l.server_id = $1 and l.token_digest = $2 and l.revoked_at is null and l.expires_at > clock_timestamp()`,
      [serverId, tokenDigest]
    );
    const server = link.rows[0];
    if (!server) return { denied: 'unavailable' };
    const inserted = await client.query(
      `insert into server_members (server_id, user_id) values ($1, $2)
       on conflict (server_id, user_id) do nothing returning user_id`, [serverId, actorId]
    );
    return { value: { server: { id: server.id, name: server.name }, joined: Boolean(inserted.rowCount), alreadyMember: !inserted.rowCount } };
  });
}
