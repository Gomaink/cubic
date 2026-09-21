import type { PoolClient } from 'pg';

export type GroupRole = 'owner' | 'admin' | 'member';

export type GroupQueryExecutor = Pick<PoolClient, 'query'>;

export interface GroupMembership {
  conversationId: string;
  avatarKey: string | null;
  role: GroupRole;
}

export function parseGroupRole(value: unknown): GroupRole | null {
  return value === 'owner' || value === 'admin' || value === 'member' ? value : null;
}

export async function resolveGroupMembership(
  executor: GroupQueryExecutor,
  conversationId: string,
  authenticatedUserId: string
): Promise<GroupMembership | null> {
  const result = await executor.query<{
    id: string;
    avatar_key: string | null;
    role: unknown;
  }>(
    `select c.id, c.avatar_key, m.role
       from conversations c
       join conversation_members m on m.conversation_id = c.id
      where c.id = $1 and c.kind = 'group' and m.user_id = $2
      limit 1`,
    [conversationId, authenticatedUserId]
  );

  const row = result.rows[0];
  const role = parseGroupRole(row?.role);
  if (!row || !role) return null;

  return {
    conversationId: row.id,
    avatarKey: row.avatar_key,
    role
  };
}

export function canManageGroup(role: GroupRole): boolean {
  return role === 'owner' || role === 'admin';
}

export function canChangeGroupRole(actorRole: GroupRole, targetRole: GroupRole): boolean {
  return actorRole === 'owner' && targetRole !== 'owner';
}

export function canRemoveGroupMember(actorRole: GroupRole, targetRole: GroupRole): boolean {
  if (targetRole === 'owner') return false;
  if (actorRole === 'owner') return true;
  return actorRole === 'admin' && targetRole === 'member';
}

export function canTransferGroupOwnership(role: GroupRole): boolean {
  return role === 'owner';
}

export function canDeleteGroup(role: GroupRole): boolean {
  return role === 'owner';
}
