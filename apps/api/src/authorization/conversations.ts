import type { Database } from '@cubic/database';

export type ConversationKind = 'direct' | 'group';
export type ConversationRole = 'owner' | 'admin' | 'member';

export interface ConversationMembership {
  conversationId: string;
  kind: ConversationKind;
  role: ConversationRole;
}

export type ConversationAccess = ConversationMembership | {
  conversationId: string;
  kind: 'server_text';
  serverId: string;
};

export type ConversationContentCreationAuthorization =
  | { allowed: true; membership: ConversationAccess }
  | { allowed: false; reason: 'not_member' | 'blocked' };

export type DirectCallStartAuthorization =
  | { allowed: true; conversationId: string; peerUserId: string }
  | { allowed: false; reason: 'not_found' | 'blocked' };

export async function resolveConversationMembership(
  database: Database,
  conversationId: string,
  authenticatedUserId: string
): Promise<ConversationMembership | null> {
  const result = await database.pool.query<{
    conversation_id: string;
    kind: string;
    role: string;
  }>(
    `select c.id as conversation_id, c.kind, cm.role
       from conversations c
       join conversation_members cm
         on cm.conversation_id = c.id
        and cm.user_id = $2
      where c.id = $1
        and c.kind in ('direct', 'group')
      limit 1`,
    [conversationId, authenticatedUserId]
  );

  const row = result.rows[0];
  if (
    !row ||
    (row.kind !== 'direct' && row.kind !== 'group') ||
    (row.role !== 'owner' && row.role !== 'admin' && row.role !== 'member')
  ) return null;
  return {
    conversationId: row.conversation_id,
    kind: row.kind,
    role: row.role
  };
}

export async function resolveConversationAccess(
  database: Database,
  conversationId: string,
  authenticatedUserId: string
): Promise<ConversationAccess | null> {
  const legacy = await resolveConversationMembership(database, conversationId, authenticatedUserId);
  if (legacy) return legacy;

  const result = await database.pool.query<{ conversation_id: string; server_id: string }>(
    `select c.id as conversation_id, channel.server_id
       from conversations c
       join server_text_channels channel on channel.conversation_id = c.id
       join server_members member
         on member.server_id = channel.server_id and member.user_id = $2
      where c.id = $1 and c.kind = 'server_text'
      limit 1`,
    [conversationId, authenticatedUserId]
  );
  const row = result.rows[0];
  return row ? { conversationId: row.conversation_id, kind: 'server_text', serverId: row.server_id } : null;
}

export async function authorizeConversationContentCreation(
  database: Database,
  conversationId: string,
  authenticatedUserId: string
): Promise<ConversationContentCreationAuthorization> {
  const membership = await resolveConversationAccess(
    database,
    conversationId,
    authenticatedUserId
  );
  if (!membership) return { allowed: false, reason: 'not_member' };
  if (membership.kind !== 'direct') return { allowed: true, membership };

  const blocked = await database.pool.query(
    `select 1
       from direct_conversation_pairs dp
       join blocks b
         on (
           b.blocker_id = dp.user_low_id
           and b.blocked_id = dp.user_high_id
         )
         or (
           b.blocker_id = dp.user_high_id
           and b.blocked_id = dp.user_low_id
         )
      where dp.conversation_id = $1
      limit 1`,
    [conversationId]
  );

  return blocked.rowCount
    ? { allowed: false, reason: 'blocked' }
    : { allowed: true, membership };
}

export async function authorizeDirectCallStart(
  database: Database,
  conversationId: string,
  authenticatedUserId: string
): Promise<DirectCallStartAuthorization> {
  const result = await database.pool.query<{
    conversation_id: string;
    peer_user_id: string;
    blocked: boolean;
  }>(
    `select c.id as conversation_id,
            case
              when dp.user_low_id = $2 then dp.user_high_id
              else dp.user_low_id
            end as peer_user_id,
            exists (
              select 1
                from blocks b
               where (b.blocker_id = dp.user_low_id and b.blocked_id = dp.user_high_id)
                  or (b.blocker_id = dp.user_high_id and b.blocked_id = dp.user_low_id)
            ) as blocked
       from conversations c
       join conversation_members cm
         on cm.conversation_id = c.id
        and cm.user_id = $2
       join direct_conversation_pairs dp
         on dp.conversation_id = c.id
      where c.id = $1
        and c.kind = 'direct'
        and ($2 = dp.user_low_id or $2 = dp.user_high_id)
      limit 1`,
    [conversationId, authenticatedUserId]
  );

  const row = result.rows[0];
  if (!row) return { allowed: false, reason: 'not_found' };
  if (row.blocked) return { allowed: false, reason: 'blocked' };
  return {
    allowed: true,
    conversationId: row.conversation_id,
    peerUserId: row.peer_user_id
  };
}
