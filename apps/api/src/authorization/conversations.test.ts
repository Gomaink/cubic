import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import {
  authorizeConversationContentCreation,
  authorizeDirectCallStart,
  resolveConversationMembership
} from './conversations.js';

const conversationId = '20000000-0000-4000-8000-000000000001';
const actorId = '10000000-0000-4000-8000-000000000001';
const peerId = '10000000-0000-4000-8000-000000000002';

class AuthorizationDatabase {
  membership: { kind: 'direct' | 'group'; role: string } | null = null;
  channelMember = false;
  channelLinked = true;
  directPair: { lowId: string; highId: string } | null = null;
  blocked = false;
  failure: Error | null = null;

  pool = {
    query: async (sql: string, params: unknown[]) => {
      if (this.failure) throw this.failure;
      const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();

      if (normalized.includes("c.kind in ('direct', 'group')")) {
        const rows = params[0] === conversationId && params[1] === actorId && this.membership
          ? [{
              conversation_id: conversationId,
              kind: this.membership.kind,
              role: this.membership.role
            }]
          : [];
        return { rows, rowCount: rows.length };
      }

      if (normalized.includes("c.kind = 'server_text'")) {
        const rows = params[0] === conversationId && params[1] === actorId &&
          this.channelMember && this.channelLinked
          ? [{ conversation_id: conversationId, server_id: '30000000-0000-4000-8000-000000000001' }]
          : [];
        return { rows, rowCount: rows.length };
      }

      if (normalized.includes('from direct_conversation_pairs dp') && normalized.includes('join blocks b')) {
        const rows = this.blocked ? [{}] : [];
        return { rows, rowCount: rows.length };
      }

      if (normalized.includes("c.kind = 'direct'")) {
        const pairContainsActor = this.directPair &&
          (this.directPair.lowId === params[1] || this.directPair.highId === params[1]);
        const rows = params[0] === conversationId && params[1] === actorId &&
          this.membership?.kind === 'direct' && pairContainsActor
          ? [{
              conversation_id: conversationId,
              peer_user_id: this.directPair!.lowId === actorId
                ? this.directPair!.highId
                : this.directPair!.lowId,
              blocked: this.blocked
            }]
          : [];
        return { rows, rowCount: rows.length };
      }

      throw new Error(`Unexpected authorization SQL: ${normalized}`);
    }
  };
}

test('conversation membership resolves members and denies outsiders or nonexistent conversations equivalently', async () => {
  const database = new AuthorizationDatabase();
  database.membership = { kind: 'group', role: 'member' };
  assert.deepEqual(
    await resolveConversationMembership(database as never, conversationId, actorId),
    { conversationId, kind: 'group', role: 'member' }
  );

  database.membership = null;
  assert.equal(
    await resolveConversationMembership(database as never, conversationId, actorId),
    null
  );
  assert.equal(
    await resolveConversationMembership(database as never, randomUUID(), actorId),
    null
  );
});

test('content creation preserves group access and bilateral direct block behavior', async () => {
  const database = new AuthorizationDatabase();
  database.membership = { kind: 'group', role: 'member' };
  assert.equal(
    (await authorizeConversationContentCreation(database as never, conversationId, actorId)).allowed,
    true
  );

  database.membership = { kind: 'direct', role: 'member' };
  assert.equal(
    (await authorizeConversationContentCreation(database as never, conversationId, actorId)).allowed,
    true
  );

  database.blocked = true;
  assert.deepEqual(
    await authorizeConversationContentCreation(database as never, conversationId, actorId),
    { allowed: false, reason: 'blocked' }
  );

  database.membership = null;
  assert.deepEqual(
    await authorizeConversationContentCreation(database as never, conversationId, actorId),
    { allowed: false, reason: 'not_member' }
  );
});

test('server text access requires a linked channel and current server membership', async () => {
  const database = new AuthorizationDatabase();
  database.channelMember = true;
  assert.deepEqual(
    await authorizeConversationContentCreation(database as never, conversationId, actorId),
    {
      allowed: true,
      membership: {
        conversationId,
        kind: 'server_text',
        serverId: '30000000-0000-4000-8000-000000000001'
      }
    }
  );
  database.channelMember = false;
  assert.deepEqual(
    await authorizeConversationContentCreation(database as never, conversationId, actorId),
    { allowed: false, reason: 'not_member' }
  );
  database.channelMember = true;
  database.channelLinked = false;
  assert.deepEqual(
    await authorizeConversationContentCreation(database as never, conversationId, actorId),
    { allowed: false, reason: 'not_member' }
  );
});

test('direct-call authorization requires current membership and pair participation and reports blocks', async () => {
  const database = new AuthorizationDatabase();
  database.membership = { kind: 'direct', role: 'member' };
  database.directPair = { lowId: actorId, highId: peerId };
  assert.deepEqual(
    await authorizeDirectCallStart(database as never, conversationId, actorId),
    { allowed: true, conversationId, peerUserId: peerId }
  );

  database.membership = null;
  assert.deepEqual(
    await authorizeDirectCallStart(database as never, conversationId, actorId),
    { allowed: false, reason: 'not_found' }
  );

  database.membership = { kind: 'direct', role: 'member' };
  database.directPair = {
    lowId: '10000000-0000-4000-8000-000000000003',
    highId: peerId
  };
  assert.deepEqual(
    await authorizeDirectCallStart(database as never, conversationId, actorId),
    { allowed: false, reason: 'not_found' }
  );

  database.directPair = { lowId: actorId, highId: peerId };
  database.blocked = true;
  assert.deepEqual(
    await authorizeDirectCallStart(database as never, conversationId, actorId),
    { allowed: false, reason: 'blocked' }
  );
});

test('database uncertainty is propagated rather than converted into authorization success', async () => {
  const database = new AuthorizationDatabase();
  database.failure = new Error('database unavailable');

  await assert.rejects(
    resolveConversationMembership(database as never, conversationId, actorId),
    /database unavailable/
  );
  await assert.rejects(
    authorizeConversationContentCreation(database as never, conversationId, actorId),
    /database unavailable/
  );
  await assert.rejects(
    authorizeDirectCallStart(database as never, conversationId, actorId),
    /database unavailable/
  );
});
