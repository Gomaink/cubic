import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Pool, type PoolClient } from 'pg';
import type { Database } from '@cubic/database';
import { withGroupLock, withLockedGroupInvite } from './groups.js';

const connectionString = process.env.CUBIC_GROUP_TEST_DATABASE_URL
  ?? process.env.CUBIC_ATTACHMENT_TEST_DATABASE_URL;

async function withTimeout<T>(operation: Promise<T>, timeoutMs = 5_000): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Timed out waiting for invite lock ordering.')), timeoutMs);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function setupDatabase(context: test.TestContext) {
  if (!connectionString) throw new Error('Test database URL is unavailable.');
  const pool = new Pool({
    connectionString,
    max: 8,
    options: '-c statement_timeout=5000'
  });
  const conversationIds = new Set<string>();
  const userIds = new Set<string>();
  context.after(async () => {
    if (conversationIds.size > 0) {
      await pool.query('delete from conversations where id = any($1::uuid[])', [[...conversationIds]]);
    }
    if (userIds.size > 0) {
      await pool.query('delete from users where id = any($1::uuid[])', [[...userIds]]);
    }
    await pool.end();
  });
  return { database: { pool } as Database, pool, conversationIds, userIds };
}

type IntegrationDatabase = Awaited<ReturnType<typeof setupDatabase>>;

async function ensureUser(testDatabase: IntegrationDatabase, userId: string) {
  testDatabase.userIds.add(userId);
  const suffix = userId.replaceAll('-', '');
  await testDatabase.pool.query(
    `insert into users (
       id, email, email_normalized, username, username_normalized, display_name, password_hash
     ) values ($1, $2, $2, $3, $3, $4, $5)
     on conflict (id) do nothing`,
    [userId, `${suffix}@integration.invalid`, `test_${suffix.slice(0, 24)}`, 'Integration Test', 'test-only']
  );
}

async function seedInvite(testDatabase: IntegrationDatabase, options: {
  conversationId?: string;
  inviteId?: string;
  inviterId?: string;
  inviteeId?: string;
} = {}) {
  const conversationId = options.conversationId ?? randomUUID();
  const inviteId = options.inviteId ?? randomUUID();
  const inviterId = options.inviterId ?? randomUUID();
  const inviteeId = options.inviteeId ?? randomUUID();
  await ensureUser(testDatabase, inviterId);
  await ensureUser(testDatabase, inviteeId);
  testDatabase.conversationIds.add(conversationId);
  await testDatabase.pool.query(
    `insert into conversations (id, kind) values ($1, 'group') on conflict do nothing`,
    [conversationId]
  );
  await testDatabase.pool.query(
    `insert into group_invites (id, conversation_id, inviter_id, invitee_id, status)
     values ($1, $2, $3, $4, 'pending')`,
    [inviteId, conversationId, inviterId, inviteeId]
  );
  return { conversationId, inviteId, inviterId, inviteeId };
}

async function acceptInvite(database: Database, inviteId: string) {
  const result = await withLockedGroupInvite(database, inviteId, async (client, invite) => {
    if (invite.status !== 'pending') return 'stale' as const;
    const count = await client.query(
      `select count(*)::int as count from conversation_members where conversation_id = $1`,
      [invite.conversationId]
    );
    const member = await client.query(
      `select 1 from conversation_members where conversation_id = $1 and user_id = $2`,
      [invite.conversationId, invite.inviteeId]
    );
    if (!member.rowCount && Number(count.rows[0]?.count ?? 0) >= 50) return 'full' as const;
    await client.query(
      `insert into conversation_members (conversation_id, user_id, role)
       values ($1, $2, 'member')
       on conflict (conversation_id, user_id) do nothing`,
      [invite.conversationId, invite.inviteeId]
    );
    const updated = await client.query(
      `update group_invites set status = 'accepted', responded_at = now()
        where id = $1 and status = 'pending' returning id`,
      [invite.id]
    );
    if (!updated.rowCount) throw new Error('Pending invite changed while locked.');
    return 'accepted' as const;
  });
  return result.status === 'missing' ? 'missing' as const : result.value;
}

async function terminalTransition(
  database: Database,
  inviteId: string,
  status: 'cancelled' | 'declined'
) {
  const result = await withLockedGroupInvite(database, inviteId, async (client, invite) => {
    if (invite.status !== 'pending') return false;
    const updated = await client.query(
      `update group_invites set status = $2, responded_at = now()
        where id = $1 and status = 'pending' returning id`,
      [invite.id, status]
    );
    return updated.rowCount === 1;
  });
  return result.status === 'found' && result.value;
}

async function reopenInvite(
  database: Database,
  invite: { conversationId: string; inviteId: string; inviterId: string; inviteeId: string },
  pauseAfterGroupLock?: () => Promise<void>
) {
  return withGroupLock(database, invite.conversationId, async (client: PoolClient) => {
    if (pauseAfterGroupLock) await pauseAfterGroupLock();
    await client.query(
      `select id from group_invites
        where conversation_id = $1 and invitee_id = $2
        for update`,
      [invite.conversationId, invite.inviteeId]
    );
    await client.query(
      `insert into group_invites (id, conversation_id, inviter_id, invitee_id, status, created_at, responded_at)
       values ($1, $2, $3, $4, 'pending', now(), null)
       on conflict (conversation_id, invitee_id)
       do update set inviter_id = excluded.inviter_id, status = 'pending', created_at = now(), responded_at = null`,
      [invite.inviteId, invite.conversationId, invite.inviterId, invite.inviteeId]
    );
  });
}

test(
  'PostgreSQL serializes accept against cancel, decline, and duplicate accept',
  { skip: !connectionString, timeout: 20_000 },
  async (context) => {
    if (!connectionString) return;
    const testDatabase = await setupDatabase(context);
    const { database, pool } = testDatabase;

    const cancelRace = await seedInvite(testDatabase);
    const [accepted, cancelled] = await withTimeout(Promise.all([
      acceptInvite(database, cancelRace.inviteId),
      terminalTransition(database, cancelRace.inviteId, 'cancelled')
    ]));
    assert.equal((accepted === 'accepted' ? 1 : 0) + (cancelled ? 1 : 0), 1);
    let state = await pool.query(
      `select gi.status,
              exists(select 1 from conversation_members cm where cm.conversation_id = gi.conversation_id and cm.user_id = gi.invitee_id) as member
         from group_invites gi where gi.id = $1`,
      [cancelRace.inviteId]
    );
    assert.equal(state.rows[0].member, state.rows[0].status === 'accepted');

    const declineRace = await seedInvite(testDatabase);
    const [acceptedAgainstDecline, declined] = await withTimeout(Promise.all([
      acceptInvite(database, declineRace.inviteId),
      terminalTransition(database, declineRace.inviteId, 'declined')
    ]));
    assert.equal((acceptedAgainstDecline === 'accepted' ? 1 : 0) + (declined ? 1 : 0), 1);

    const duplicate = await seedInvite(testDatabase);
    const duplicateResults = await withTimeout(Promise.all([
      acceptInvite(database, duplicate.inviteId),
      acceptInvite(database, duplicate.inviteId)
    ]));
    assert.equal(duplicateResults.filter((value) => value === 'accepted').length, 1);
    state = await pool.query(
      `select count(*)::int as count from conversation_members where conversation_id = $1 and user_id = $2`,
      [duplicate.conversationId, duplicate.inviteeId]
    );
    assert.equal(state.rows[0].count, 1);
  }
);

test(
  'PostgreSQL create/reopen and accept use group-before-invite order without deadlock',
  { skip: !connectionString, timeout: 10_000 },
  async (context) => {
    if (!connectionString) return;
    const testDatabase = await setupDatabase(context);
    const { database, pool } = testDatabase;
    const invite = await seedInvite(testDatabase);
    await pool.query(`update group_invites set status = 'declined' where id = $1`, [invite.inviteId]);

    let releasePause: (() => void) | undefined;
    const acceptMayStart = new Promise<void>((resolve) => { releasePause = resolve; });
    let groupLockHeld: (() => void) | undefined;
    const groupLockAcquired = new Promise<void>((resolve) => { groupLockHeld = resolve; });
    const reopen = reopenInvite(database, invite, async () => {
      groupLockHeld?.();
      await acceptMayStart;
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    await groupLockAcquired;
    const accept = acceptInvite(database, invite.inviteId);
    releasePause?.();

    const [, accepted] = await withTimeout(Promise.all([reopen, accept]));
    assert.equal(accepted, 'accepted');
    const state = await pool.query(
      `select gi.status,
              exists(select 1 from conversation_members cm where cm.conversation_id = gi.conversation_id and cm.user_id = gi.invitee_id) as member
         from group_invites gi where gi.id = $1`,
      [invite.inviteId]
    );
    assert.deepEqual(state.rows[0], { status: 'accepted', member: true });

    await pool.query(`update group_invites set status = 'cancelled' where id = $1`, [invite.inviteId]);
    await withTimeout(Promise.all([
      reopenInvite(database, invite),
      terminalTransition(database, invite.inviteId, 'cancelled')
    ]));
    const cancelReopen = await pool.query(`select status from group_invites where id = $1`, [invite.inviteId]);
    assert.ok(cancelReopen.rows[0].status === 'pending' || cancelReopen.rows[0].status === 'cancelled');
  }
);

test(
  'PostgreSQL group lock prevents concurrent accepts from exceeding member capacity',
  { skip: !connectionString, timeout: 10_000 },
  async (context) => {
    if (!connectionString) return;
    const testDatabase = await setupDatabase(context);
    const { database, pool } = testDatabase;
    const conversationId = randomUUID();
    testDatabase.conversationIds.add(conversationId);
    await pool.query(`insert into conversations (id, kind) values ($1, 'group')`, [conversationId]);
    const existingMembers = Array.from({ length: 49 }, () => randomUUID());
    for (const memberId of existingMembers) {
      await ensureUser(testDatabase, memberId);
      await pool.query(
        `insert into conversation_members (conversation_id, user_id, role) values ($1, $2, 'member')`,
        [conversationId, memberId]
      );
    }
    const inviteA = await seedInvite(testDatabase, { conversationId });
    const inviteB = await seedInvite(testDatabase, { conversationId });

    const results = await withTimeout(Promise.all([
      acceptInvite(database, inviteA.inviteId),
      acceptInvite(database, inviteB.inviteId)
    ]));
    assert.equal(results.filter((value) => value === 'accepted').length, 1);
    assert.equal(results.filter((value) => value === 'full').length, 1);
    const count = await pool.query(
      `select count(*)::int as count from conversation_members where conversation_id = $1`,
      [conversationId]
    );
    assert.equal(count.rows[0].count, 50);
  }
);
