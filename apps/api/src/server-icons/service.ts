import type { PoolClient } from 'pg';
import type { Database } from '@cubic/database';
import { canonicalServerIcon, ServerIconStore } from './storage.js';

type Denied = { denied: 'not_found' | 'not_owner' };
type Logger = { warn(bindings: Record<string, unknown>, message: string): void };

async function ownerUnderLock(client: PoolClient, serverId: string, actorId: string): Promise<
  { iconKey: string | null } | Denied
> {
  const locked = await client.query<{ owner_user_id: string; icon_key: string | null }>(
    'select owner_user_id, icon_key from servers where id = $1 for update', [serverId]
  );
  const server = locked.rows[0];
  if (!server) return { denied: 'not_found' };
  if (server.owner_user_id !== actorId) {
    const membership = await client.query('select 1 from server_members where server_id = $1 and user_id = $2', [serverId, actorId]);
    return { denied: membership.rowCount ? 'not_owner' : 'not_found' };
  }
  return { iconKey: server.icon_key };
}

export async function checkIconOwner(database: Database, serverId: string, actorId: string): Promise<true | Denied> {
  const result = await database.pool.query<{ owner_user_id: string; is_member: boolean }>(
    `select s.owner_user_id, exists(select 1 from server_members m where m.server_id = s.id and m.user_id = $2) as is_member
       from servers s where s.id = $1`, [serverId, actorId]
  );
  const row = result.rows[0];
  if (!row || !row.is_member) return { denied: 'not_found' };
  if (row.owner_user_id !== actorId) return { denied: 'not_owner' };
  return true;
}

export async function replaceServerIcon(options: {
  database: Database; store: ServerIconStore; serverId: string; actorId: string; input: Buffer; logger: Logger;
}): Promise<true | Denied> {
  const canonical = await canonicalServerIcon(options.input);
  const temp = await options.store.writeTemp(canonical);
  let client: PoolClient | null = null;
  let committed = false;
  let newKey: string | null = null;
  let oldKey: string | null = null;
  try {
    client = await options.database.pool.connect();
    await client.query('begin');
    const authority = await ownerUnderLock(client, options.serverId, options.actorId);
    if ('denied' in authority) {
      await client.query('rollback');
      return authority;
    }
    oldKey = authority.iconKey;
    newKey = await options.store.publish(temp);
    await client.query('update servers set icon_key = $2, updated_at = now() where id = $1', [options.serverId, newKey]);
    await client.query('commit');
    committed = true;
  } catch (error) {
    await client?.query('rollback').catch(() => {});
    throw error;
  } finally {
    client?.release();
    if (!committed) {
      await options.store.deleteTemp(temp).catch(() => {});
      if (newKey) {
        // A failed COMMIT acknowledgement is ambiguous. Never delete a file that
        // might already be referenced; an unreferenced file is swept later.
        const reference = await options.database.pool.query(
          'select 1 from servers where icon_key = $1 limit 1', [newKey]
        ).catch(() => null);
        if (reference && !reference.rowCount) await options.store.deleteCanonical(newKey).catch(() => {});
      }
    }
  }
  if (oldKey) {
    await options.store.deleteCanonical(oldKey).catch((error) => {
      options.logger.warn({ code: (error as NodeJS.ErrnoException).code ?? 'UNKNOWN' }, 'Old server icon could not be deleted; reconciliation will retry');
    });
  }
  return true;
}

export async function removeServerIcon(options: {
  database: Database; store: ServerIconStore; serverId: string; actorId: string; logger: Logger;
}): Promise<true | Denied> {
  const client = await options.database.pool.connect();
  let oldKey: string | null = null;
  try {
    await client.query('begin');
    const authority = await ownerUnderLock(client, options.serverId, options.actorId);
    if ('denied' in authority) { await client.query('rollback'); return authority; }
    oldKey = authority.iconKey;
    await client.query('update servers set icon_key = null, updated_at = now() where id = $1', [options.serverId]);
    await client.query('commit');
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally { client.release(); }
  if (oldKey) {
    await options.store.deleteCanonical(oldKey).catch((error) => {
      options.logger.warn({ code: (error as NodeJS.ErrnoException).code ?? 'UNKNOWN' }, 'Removed server icon could not be deleted; reconciliation will retry');
    });
  }
  return true;
}
