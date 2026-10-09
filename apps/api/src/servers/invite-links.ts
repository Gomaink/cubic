import { createHash, randomBytes } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { Database } from '@cubic/database';
import { requireServerPermission } from '../authorization/server-permissions.js';
import type { InviteCredentials } from './invite-credentials.js';

export const INVITE_EXPIRATIONS = { '1h': 3600000, '1d': 86400000, '7d': 604800000, '30d': 2592000000, never: null } as const;
export type InviteExpiration = keyof typeof INVITE_EXPIRATIONS;
export type InviteSettings = { expiration?: InviteExpiration | undefined; maxUses?: 1 | 5 | 10 | 25 | 100 | null | undefined };
const LEGACY_TOKEN = /^[A-Za-z0-9_-]{43}$/;
type Denial = 'not_found' | 'not_owner' | 'unavailable' | 'invalid';
type Result<T> = { value: T } | { denied: Denial };
export interface InviteLinkMetadata {
  id: string; createdAt: string; updatedAt: string; expiresAt: string | null; revokedAt: string | null;
  maxUses: number | null; useCount: number; lastUsedAt: string | null; creatorUserId: string | null;
  status: 'Active' | 'Expired' | 'Exhausted' | 'Revoked' | 'Paused';
}
export interface InviteLinkPreview { server: { id: string; name: string }; alreadyMember?: boolean }
const iso = (value: string | Date | null): string | null => value === null ? null : new Date(value).toISOString();
function metadata(row: any): InviteLinkMetadata {
  return { id: row.id, createdAt: iso(row.created_at)!, updatedAt: iso(row.updated_at)!,
    expiresAt: iso(row.expires_at), revokedAt: iso(row.revoked_at), maxUses: row.max_uses,
    useCount: row.use_count, lastUsedAt: iso(row.last_used_at), creatorUserId: row.creator_user_id, status: row.status };
}
const projection = `l.id,l.created_at,l.updated_at,l.expires_at,l.revoked_at,l.max_uses,l.use_count,l.last_used_at,l.creator_user_id,
  case when l.revoked_at is not null then 'Revoked'
       when l.expires_at is not null and l.expires_at <= clock_timestamp() then 'Expired'
       when l.max_uses is not null and l.use_count >= l.max_uses then 'Exhausted'
       when s.invites_paused_at is not null then 'Paused' else 'Active' end as status`;

export function validInviteLinkToken(token: unknown): token is string {
  return typeof token === 'string' && (LEGACY_TOKEN.test(token) || /^v2\.[a-z0-9_-]{1,24}\.[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/.test(token));
}
const digest = (token: string) => createHash('sha256').update(token).digest('hex');
function locate(token: string, credentials?: InviteCredentials | null): { id?: string; digest?: string } | null {
  if (LEGACY_TOKEN.test(token)) return { digest: digest(token) };
  if (!credentials) throw new Error('Invite link HMAC keys are not configured.');
  const id = credentials.verify(token);
  return id ? { id } : null;
}
function expiry(option: InviteExpiration, now = new Date()): Date | null {
  const duration = INVITE_EXPIRATIONS[option];
  return duration === null ? null : new Date(now.getTime() + duration);
}
async function withServer<T>(database: Database, serverId: string, action: (client: PoolClient, owner: string | null, paused: boolean) => Promise<T>): Promise<T> {
  const client = await database.pool.connect();
  try {
    await client.query('begin');
    const rows = await client.query<{ owner_user_id: string; invites_paused_at: Date | null }>(
      'select owner_user_id,invites_paused_at from servers where id=$1 for update', [serverId]);
    const result = await action(client, rows.rows[0]?.owner_user_id ?? null, Boolean(rows.rows[0]?.invites_paused_at));
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally { client.release(); }
}
async function denied(client: PoolClient, serverId: string, actorId: string): Promise<Denial | null> {
  const authority = await requireServerPermission(client, serverId, actorId, 'MANAGE_INVITES');
  return 'denied' in authority ? authority.denied === 'forbidden' ? 'not_owner' : 'not_found' : null;
}
function keys(credentials?: InviteCredentials | null): InviteCredentials {
  if (!credentials) throw new Error('Invite link HMAC keys are not configured.');
  return credentials;
}

export async function createServerInviteLink(database: Database, serverId: string, actorId: string,
  credentials?: InviteCredentials | null, settings: InviteSettings = {}): Promise<Result<{ inviteLink: InviteLinkMetadata; token: string }>> {
  const codec = keys(credentials);
  return withServer(database, serverId, async (client, owner, paused) => {
    if (!owner) return { denied: 'not_found' };
    const no = await denied(client, serverId, actorId);
    if (no) return { denied: no };
    if (paused) return { denied: 'unavailable' };
    const createdAt = new Date();
    const inserted = await client.query(`insert into server_invite_links(server_id,creator_user_id,token_digest,created_at,expires_at,max_uses)
      values($1,$2,$3,$4,$5,$6) returning id`,
      [serverId, actorId, randomBytes(32).toString('hex'), createdAt, expiry(settings.expiration ?? '7d', createdAt), settings.maxUses ?? null]);
    const id = inserted.rows[0].id as string;
    const token = codec.issue(id);
    const row = await client.query(`update server_invite_links l set token_digest=$2 from servers s
      where l.id=$1 and s.id=l.server_id returning ${projection}`, [id, digest(token)]);
    return { value: { inviteLink: metadata(row.rows[0]), token } };
  });
}

export async function listManagedServerInviteLinks(database: Database, serverId: string, actorId: string, page = 0):
  Promise<Result<{ inviteLinks: InviteLinkMetadata[]; nextPage: number | null; paused: boolean }>> {
  return withServer(database, serverId, async (client, owner, paused) => {
    if (!owner || await denied(client, serverId, actorId)) return { denied: 'not_found' };
    const rows = await client.query(`select ${projection} from server_invite_links l join servers s on s.id=l.server_id
      where l.server_id=$1 order by l.created_at desc,l.id desc limit 21 offset $2`, [serverId, page * 20]);
    return { value: { inviteLinks: rows.rows.slice(0, 20).map(metadata), nextPage: rows.rows.length > 20 ? page + 1 : null, paused } };
  });
}

export async function copyServerInviteLink(database: Database, serverId: string, linkId: string, actorId: string,
  credentials?: InviteCredentials | null): Promise<Result<{ token: string }>> {
  const codec = keys(credentials);
  return withServer(database, serverId, async (client, owner) => {
    if (!owner) return { denied: 'not_found' };
    const no = await denied(client, serverId, actorId);
    if (no) return { denied: no };
    const row = await client.query(`select 1 from server_invite_links where id=$1 and server_id=$2
      and revoked_at is null and (expires_at is null or expires_at > clock_timestamp())`, [linkId, serverId]);
    return row.rowCount ? { value: { token: codec.issue(linkId) } } : { denied: 'unavailable' };
  });
}

export async function updateServerInviteLink(database: Database, serverId: string, linkId: string, actorId: string,
  settings: InviteSettings): Promise<Result<InviteLinkMetadata>> {
  return withServer(database, serverId, async (client, owner) => {
    if (!owner) return { denied: 'not_found' };
    const no = await denied(client, serverId, actorId);
    if (no) return { denied: no };
    const rows = await client.query<{ use_count: number; revoked_at: Date | null; expires_at: Date | null }>(
      'select use_count,revoked_at,expires_at from server_invite_links where id=$1 and server_id=$2 for update', [linkId, serverId]);
    const link = rows.rows[0];
    if (!link) return { denied: 'not_found' };
    const now = await client.query<{ now: Date }>('select clock_timestamp() as now');
    if (link.revoked_at || (link.expires_at && link.expires_at <= now.rows[0]!.now)) return { denied: 'unavailable' };
    if (settings.maxUses !== undefined && settings.maxUses !== null && settings.maxUses < link.use_count) return { denied: 'invalid' };
    const row = await client.query(`update server_invite_links l set expires_at=$3,
      max_uses=case when $4::boolean then $5::integer else l.max_uses end, updated_at=clock_timestamp()
      from servers s where l.id=$1 and l.server_id=$2 and s.id=l.server_id returning ${projection}`,
      [linkId, serverId, settings.expiration === undefined ? link.expires_at : expiry(settings.expiration, now.rows[0]!.now),
        settings.maxUses !== undefined, settings.maxUses ?? null]);
    return { value: metadata(row.rows[0]) };
  });
}

export async function revokeServerInviteLink(database: Database, serverId: string, linkId: string, actorId: string): Promise<Result<InviteLinkMetadata>> {
  return withServer(database, serverId, async (client, owner) => {
    if (!owner) return { denied: 'not_found' };
    const no = await denied(client, serverId, actorId);
    if (no) return { denied: no };
    const row = await client.query(`update server_invite_links l set revoked_at=coalesce(l.revoked_at,clock_timestamp()),updated_at=clock_timestamp()
      from servers s where l.id=$1 and l.server_id=$2 and s.id=l.server_id returning ${projection}`, [linkId, serverId]);
    return row.rows[0] ? { value: metadata(row.rows[0]) } : { denied: 'not_found' };
  });
}

export async function setServerInvitesPaused(database: Database, serverId: string, actorId: string, paused: boolean): Promise<Result<{ paused: boolean }>> {
  return withServer(database, serverId, async (client, owner) => {
    if (!owner) return { denied: 'not_found' };
    const no = await denied(client, serverId, actorId);
    if (no) return { denied: no };
    await client.query('update servers set invites_paused_at=case when $2::boolean then coalesce(invites_paused_at,clock_timestamp()) else null end where id=$1', [serverId, paused]);
    return { value: { paused } };
  });
}

export async function previewServerInviteLink(database: Database, token: string, actorId?: string,
  credentials?: InviteCredentials | null): Promise<Result<InviteLinkPreview>> {
  const target = locate(token, credentials);
  if (!target) return { denied: 'unavailable' };
  const rows = await database.pool.query(`select s.id,s.name${actorId ? ',exists(select 1 from server_members m where m.server_id=s.id and m.user_id=$2) as already_member' : ''}
    from server_invite_links l join servers s on s.id=l.server_id
    where ${target.id ? 'l.id' : 'l.token_digest'}=$1 and s.invites_paused_at is null and l.revoked_at is null
      and (l.expires_at is null or l.expires_at > clock_timestamp())
      and (l.max_uses is null or l.use_count < l.max_uses${actorId ? ' or exists(select 1 from server_members mine where mine.server_id=s.id and mine.user_id=$2)' : ''})`,
    actorId ? [target.id ?? target.digest, actorId] : [target.id ?? target.digest]);
  const row = rows.rows[0];
  return row ? { value: { server: { id: row.id, name: row.name }, ...(actorId ? { alreadyMember: row.already_member } : {}) } } : { denied: 'unavailable' };
}

export async function joinServerViaInviteLink(database: Database, token: string, actorId: string,
  credentials?: InviteCredentials | null): Promise<Result<InviteLinkPreview & { joined: boolean }>> {
  const target = locate(token, credentials);
  if (!target) return { denied: 'unavailable' };
  const candidate = await database.pool.query<{ server_id: string }>(
    `select server_id from server_invite_links where ${target.id ? 'id' : 'token_digest'}=$1`, [target.id ?? target.digest]);
  const serverId = candidate.rows[0]?.server_id;
  if (!serverId) return { denied: 'unavailable' };
  return withServer(database, serverId, async (client, owner, paused) => {
    if (!owner || paused) return { denied: 'unavailable' };
    const rows = await client.query<{ id: string; name: string; revoked_at: Date | null; expires_at: Date | null; max_uses: number | null; use_count: number }>(
      `select l.id,s.name,l.revoked_at,l.expires_at,l.max_uses,l.use_count from server_invite_links l
       join servers s on s.id=l.server_id where l.server_id=$1 and ${target.id ? 'l.id' : 'l.token_digest'}=$2 for update of l`,
      [serverId, target.id ?? target.digest]);
    const link = rows.rows[0];
    if (!link || link.revoked_at) return { denied: 'unavailable' };
    const time = await client.query<{ now: Date }>('select clock_timestamp() as now');
    if (link.expires_at && link.expires_at <= time.rows[0]!.now) return { denied: 'unavailable' };
    const member = await client.query('select 1 from server_members where server_id=$1 and user_id=$2', [serverId, actorId]);
    if (member.rowCount) return { value: { server: { id: serverId, name: link.name }, joined: false, alreadyMember: true } };
    if (link.max_uses !== null && link.use_count >= link.max_uses) return { denied: 'unavailable' };
    const inserted = await client.query(`insert into server_members(server_id,user_id) values($1,$2)
      on conflict (server_id,user_id) do nothing returning user_id`, [serverId, actorId]);
    if (inserted.rowCount) await client.query(`update server_invite_links set use_count=use_count+1,
      last_used_at=clock_timestamp(),updated_at=clock_timestamp() where id=$1`, [link.id]);
    return { value: { server: { id: serverId, name: link.name }, joined: Boolean(inserted.rowCount), alreadyMember: !inserted.rowCount } };
  });
}
