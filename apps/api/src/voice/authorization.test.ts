import assert from 'node:assert/strict';
import test from 'node:test';
import { ServerError, TokenVerifier } from 'livekit-server-sdk';
import type { PublicUser } from '@cubic/shared';
import type { Database } from '@cubic/database';
import type { RealtimeEvents } from '../realtime/events.js';
import { createRealtimeEvents } from '../realtime/events.js';
import type { SessionService } from '../security/session.js';
import {
  LiveKitAuthorizationService,
  LiveKitControlPlaneUnavailableError,
  VoiceAuthorizationDeniedError,
  createDatabaseVoiceAuthorizationStore,
  type AuthorizedVoiceScope,
  type LiveKitAdminClient,
  type ManagedVoiceRoom,
  type VoiceAuthorizationStore
} from './authorization.js';
import {
  directVoiceRoomName,
  roomScopedSessionTag,
  voiceParticipantIdentity,
  voiceRoomName
} from './token.js';

const apiKey = 'CUBIC_TEST_KEY';
const apiSecret = 'cubic-test-secret-that-is-longer-than-thirty-two-characters';
const userId = '10000000-0000-4000-8000-000000000001';
const otherUserId = '10000000-0000-4000-8000-000000000002';
const sessionId = '60000000-0000-4000-8000-000000000001';
const otherSessionId = '60000000-0000-4000-8000-000000000002';
const conversationId = '20000000-0000-4000-8000-000000000001';
const callId = '30000000-0000-4000-8000-000000000001';

function publicUser(id: string): PublicUser {
  return {
    id,
    username: `user-${id.slice(-4)}`,
    displayName: `User ${id.slice(-4)}`,
    avatarUrl: null,
    createdAt: '2026-01-01T00:00:00.000Z'
  };
}

class FakeSessions {
  readonly sessions = new Map<string, string>([
    [sessionId, userId],
    [otherSessionId, userId]
  ]);
  uncertain = false;
  readonly disabledUsers = new Set<string>();

  async validateId(id: string) {
    if (this.uncertain) throw new Error('database unavailable');
    const owner = this.sessions.get(id);
    if (owner && this.disabledUsers.has(owner)) return null;
    return owner ? {
      sessionId: id,
      user: publicUser(owner),
      expiresAt: new Date(Date.now() + 60_000)
    } : null;
  }

  async listActiveForUser(owner: string) {
    if (this.uncertain) throw new Error('database unavailable');
    return [...this.sessions]
      .filter(([, sessionOwner]) => sessionOwner === owner)
      .map(([id]) => ({
        id,
        client: 'Unknown client',
        createdAt: new Date(),
        lastSeenAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000)
      }));
  }
}

class FakeStore implements VoiceAuthorizationStore {
  scope: AuthorizedVoiceScope | null = {
    kind: 'group',
    conversationId,
    roomName: voiceRoomName(conversationId),
    callId: null
  };
  room: ManagedVoiceRoom | null = {
    kind: 'group', conversationId, callId: null, valid: true
  };
  uncertain = false;
  resolutionCount = 0;
  finalBarrier: Promise<void> | null = null;

  async resolveScope(): Promise<AuthorizedVoiceScope | null> {
    if (this.uncertain) throw new Error('database unavailable');
    this.resolutionCount += 1;
    if (this.resolutionCount > 1) await this.finalBarrier;
    return this.scope;
  }

  async resolveManagedRoom(): Promise<ManagedVoiceRoom | null> {
    if (this.uncertain) throw new Error('database unavailable');
    return this.room;
  }
}

class FakeAdmin implements LiveKitAdminClient {
  rooms: Array<{ name: string }> = [];
  participants = new Map<string, Array<{
    identity: string;
    attributes?: Record<string, string>;
  }>>();
  removals: Array<{ room: string; identity: string; revokeTokenTs?: bigint }> = [];
  deletions: string[] = [];
  failListRooms = false;
  failRemove = false;
  absent = false;
  listRoomsBarrier: Promise<void> | null = null;

  async listRooms() {
    await this.listRoomsBarrier;
    if (this.failListRooms) throw new Error('control plane unavailable');
    return this.rooms;
  }

  async listParticipants(room: string) {
    return this.participants.get(room) ?? [];
  }

  async removeParticipant(room: string, identity: string, options?: { revokeTokenTs?: bigint }) {
    if (this.failRemove) throw new Error('control plane unavailable');
    if (this.absent) throw new ServerError('not_found', 'participant not found', 404, 'not_found');
    this.removals.push({
      room,
      identity,
      ...(options?.revokeTokenTs === undefined ? {} : { revokeTokenTs: options.revokeTokenTs })
    });
  }

  async deleteRoom(room: string) {
    if (this.absent) throw new ServerError('not_found', 'room not found', 404, 'not_found');
    this.deletions.push(room);
  }
}

function harness(limits: { maximumQueueSize?: number; maximumRegistrySize?: number } = {}) {
  const sessions = new FakeSessions();
  const store = new FakeStore();
  const admin = new FakeAdmin();
  const events = createRealtimeEvents();
  const service = new LiveKitAuthorizationService({
    apiKey,
    apiSecret,
    apiUrl: 'http://livekit.test',
    publicUrl: 'wss://livekit.test',
    sessionService: sessions as unknown as SessionService,
    store,
    events,
    adminClient: admin,
    reconciliationIntervalMs: 30_000,
    ...limits,
    random: () => 0
  });
  return { sessions, store, admin, events, service };
}

async function issue(
  service: LiveKitAuthorizationService,
  overrides: Partial<Parameters<LiveKitAuthorizationService['issueJoinTicket']>[0]> = {}
) {
  return service.issueJoinTicket({
    sessionId,
    userId,
    displayName: 'User',
    conversationId,
    participantInstanceId: '40000000-0000-4000-8000-000000000001',
    ...overrides
  });
}

async function eventually(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('condition was not reached');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

test('issuance retains exact media grants and an opaque session-specific identity', async (context) => {
  const { service } = harness();
  context.after(() => service.stop());
  const ticket = await issue(service);
  const claims = await new TokenVerifier(apiKey, apiSecret).verify(ticket.token);

  assert.equal(claims.video?.room, voiceRoomName(conversationId));
  assert.equal(claims.video?.roomJoin, true);
  assert.equal(claims.video?.canSubscribe, true);
  assert.equal(claims.video?.canPublish, true);
  assert.equal(claims.video?.canPublishData, false);
  assert.equal(claims.video?.canUpdateOwnMetadata, false);
  assert.deepEqual(claims.video?.canPublishSources, [
    'microphone', 'camera', 'screen_share', 'screen_share_audio'
  ]);
  assert.doesNotMatch(ticket.participantIdentity, new RegExp(sessionId));
  assert.doesNotMatch(JSON.stringify(claims), new RegExp(sessionId));
});

test('accepted direct calls use call-specific rooms and later calls cannot reuse the old room', async (context) => {
  const { service, store } = harness();
  context.after(() => service.stop());
  store.scope = {
    kind: 'direct', conversationId, callId, roomName: directVoiceRoomName(callId)
  };
  const first = await issue(service);
  const laterCallId = '30000000-0000-4000-8000-000000000002';
  store.scope = {
    kind: 'direct',
    conversationId,
    callId: laterCallId,
    roomName: directVoiceRoomName(laterCallId)
  };
  const later = await issue(service, {
    participantInstanceId: '40000000-0000-4000-8000-000000000002'
  });
  assert.notEqual(first.roomName, later.roomName);
});

test('non-accepted direct lifecycle states uniformly deny issuance', async (context) => {
  for (const state of ['ringing', 'declined', 'cancelled', 'missed', 'ended', 'interrupted', 'stale', 'unknown']) {
    const { service, store } = harness();
    context.after(() => service.stop());
    store.scope = null;
    await assert.rejects(issue(service), VoiceAuthorizationDeniedError, state);
  }
});

test('revoking one session removes only its participant instances', async (context) => {
  const { service, events, admin } = harness();
  context.after(() => service.stop());
  const first = await issue(service);
  const sameSessionTab = await issue(service, {
    participantInstanceId: '40000000-0000-4000-8000-000000000004'
  });
  const second = await issue(service, {
    sessionId: otherSessionId,
    participantInstanceId: '40000000-0000-4000-8000-000000000002'
  });

  events.emitSessionRevoked({ sessionId });
  await eventually(() => admin.removals.length === 2);
  assert.deepEqual(
    new Set(admin.removals.map((entry) => entry.identity)),
    new Set([first.participantIdentity, sameSessionTab.participantIdentity])
  );
  assert.equal(admin.removals.some((entry) => entry.identity === second.participantIdentity), false);
  assert.ok(admin.removals.every((entry) => entry.revokeTokenTs === undefined));
});

test('logout-all style events remove all sessions while duplicate work deduplicates', async (context) => {
  const { service, events, admin } = harness();
  context.after(() => service.stop());
  const first = await issue(service);
  const second = await issue(service, {
    sessionId: otherSessionId,
    participantInstanceId: '40000000-0000-4000-8000-000000000002'
  });
  admin.failRemove = true;
  events.emitSessionRevoked({ sessionId });
  events.emitSessionRevoked({ sessionId });
  events.emitSessionRevoked({ sessionId: otherSessionId });
  await eventually(() => !service.healthy);
  assert.equal(service.queuedTaskCount, 2);
  assert.deepEqual(
    new Set([first.participantIdentity, second.participantIdentity]).size,
    2
  );
});

test('absent participants and rooms are idempotent successes', async (context) => {
  const { service, events, admin } = harness();
  context.after(() => service.stop());
  await issue(service);
  admin.absent = true;
  events.emitSessionRevoked({ sessionId });
  events.emitConversationRemoved({
    conversationId,
    removedUserIds: [userId],
    remainingUserIds: []
  });
  await eventually(() => service.queuedTaskCount === 0);
  assert.equal(service.healthy, true);
});

test('group removal targets only the removed member and group deletion deletes the room', async (context) => {
  const { service, sessions, events, admin } = harness();
  context.after(() => service.stop());
  sessions.sessions.set('60000000-0000-4000-8000-000000000003', otherUserId);
  const removed = await issue(service);
  const remaining = await issue(service, {
    sessionId: '60000000-0000-4000-8000-000000000003',
    userId: otherUserId,
    participantInstanceId: '40000000-0000-4000-8000-000000000003'
  });
  events.emitConversationRemoved({
    conversationId,
    removedUserIds: [userId],
    remainingUserIds: [otherUserId]
  });
  await eventually(() => admin.removals.length === 1);
  assert.equal(admin.removals[0]?.identity, removed.participantIdentity);
  assert.notEqual(admin.removals[0]?.identity, remaining.participantIdentity);

  events.emitConversationRemoved({
    conversationId,
    removedUserIds: [otherUserId],
    remainingUserIds: []
  });
  await eventually(() => admin.deletions.includes(voiceRoomName(conversationId)));
});

test('block revokes both directions and deletes the accepted direct room', async (context) => {
  const { service, sessions, store, events, admin } = harness();
  context.after(() => service.stop());
  sessions.sessions.set('60000000-0000-4000-8000-000000000003', otherUserId);
  store.scope = {
    kind: 'direct', conversationId, callId, roomName: directVoiceRoomName(callId)
  };
  await issue(service);
  await issue(service, {
    sessionId: '60000000-0000-4000-8000-000000000003',
    userId: otherUserId,
    participantInstanceId: '40000000-0000-4000-8000-000000000003'
  });
  store.scope = null;
  events.emitDirectBlocked({
    conversationId,
    blockerId: userId,
    blockedId: otherUserId,
    callId
  });
  await eventually(() => admin.removals.length === 2 && admin.deletions.length === 1);
  await assert.rejects(issue(service), VoiceAuthorizationDeniedError);
  await assert.rejects(issue(service, {
    sessionId: '60000000-0000-4000-8000-000000000003',
    userId: otherUserId,
    participantInstanceId: '40000000-0000-4000-8000-000000000005'
  }), VoiceAuthorizationDeniedError);
});

test('disabled accounts cannot mint and are positively removed by reconciliation', async (context) => {
  const { service, sessions, admin } = harness();
  context.after(() => service.stop());
  sessions.disabledUsers.add(userId);
  await assert.rejects(issue(service), VoiceAuthorizationDeniedError);

  const roomName = voiceRoomName(conversationId);
  const identity = voiceParticipantIdentity(
    roomScopedSessionTag(apiSecret, roomName, sessionId),
    '40000000-0000-4000-8000-000000000006'
  );
  admin.rooms = [{ name: roomName }];
  admin.participants.set(roomName, [{
    identity,
    attributes: { cubicUserId: userId, cubicConversationId: conversationId }
  }]);
  await service.reconcile();
  await eventually(() => admin.removals.some((entry) => entry.identity === identity));
});

test('reconciliation removes invalid, malformed, legacy, and disabled-session participants', async (context) => {
  const { service, sessions, store, admin } = harness();
  context.after(() => service.stop());
  const roomName = voiceRoomName(conversationId);
  const validIdentity = voiceParticipantIdentity(
    roomScopedSessionTag(apiSecret, roomName, sessionId),
    '40000000-0000-4000-8000-000000000001'
  );
  const malformed = `${userId}.40000000-0000-4000-8000-000000000002`;
  admin.rooms = [{ name: roomName }];
  admin.participants.set(roomName, [
    {
      identity: validIdentity,
      attributes: { cubicUserId: userId, cubicConversationId: conversationId }
    },
    {
      identity: malformed,
      attributes: { cubicUserId: userId, cubicConversationId: conversationId }
    }
  ]);

  await service.reconcile();
  await eventually(() => admin.removals.length === 1);
  assert.equal(admin.removals[0]?.identity, malformed);

  sessions.disabledUsers.add(userId);
  await service.reconcile();
  await eventually(() => admin.removals.some((entry) => entry.identity === validIdentity));

  store.room = { kind: 'group', conversationId, callId: null, valid: false };
  await service.reconcile();
  await eventually(() => admin.deletions.includes(roomName));
});

test('an authorization event during issuance cancels the proposed participant', async (context) => {
  const { service, store, events } = harness();
  context.after(() => service.stop());
  let release!: () => void;
  store.finalBarrier = new Promise<void>((resolve) => { release = resolve; });
  const pending = issue(service);
  await eventually(() => store.resolutionCount === 2);
  events.emitSessionRevoked({ sessionId });
  release();
  await assert.rejects(pending, VoiceAuthorizationDeniedError);
});

test('transient participant removal failures retain bounded work and retry successfully', async (context) => {
  const { service, events, admin } = harness();
  context.after(() => service.stop());
  await issue(service);
  admin.failRemove = true;
  events.emitSessionRevoked({ sessionId });
  await eventually(() => !service.healthy);
  assert.equal(service.queuedTaskCount, 1);
  admin.failRemove = false;
  await eventually(() => admin.removals.length === 1, 1_500);
  assert.equal(service.queuedTaskCount, 0);
  assert.equal(service.healthy, true);
});

test('revocation queue capacity is bounded and degrades new issuance', async (context) => {
  const { service, events, admin } = harness({ maximumQueueSize: 1 });
  context.after(() => service.stop());
  await issue(service);
  await issue(service, {
    participantInstanceId: '40000000-0000-4000-8000-000000000002'
  });
  admin.failRemove = true;
  events.emitSessionRevoked({ sessionId });
  await eventually(() => !service.healthy);
  assert.equal(service.queuedTaskCount, 1);
  await assert.rejects(issue(service), LiveKitControlPlaneUnavailableError);
});

test('database uncertainty preserves participants and reconciliation does not overlap', async (context) => {
  const { service, store, admin } = harness();
  context.after(() => service.stop());
  const roomName = voiceRoomName(conversationId);
  admin.rooms = [{ name: roomName }];
  admin.participants.set(roomName, [{
    identity: 'legacy.identity',
    attributes: { cubicUserId: userId, cubicConversationId: conversationId }
  }]);
  store.uncertain = true;
  await service.reconcile();
  assert.equal(admin.removals.length, 0);

  let release!: () => void;
  admin.listRoomsBarrier = new Promise<void>((resolve) => { release = resolve; });
  store.uncertain = false;
  const first = service.reconcile();
  const second = service.reconcile();
  assert.equal(first, second);
  release();
  await first;
  await eventually(() => admin.removals.some((entry) => entry.identity === 'legacy.identity'));
});

test('reconciliation deletes ended direct-call rooms without touching unrelated rooms', async (context) => {
  const { service, store, admin } = harness();
  context.after(() => service.stop());
  const directRoom = directVoiceRoomName(callId);
  admin.rooms = [{ name: directRoom }, { name: 'operator-managed-room' }];
  store.room = {
    kind: 'direct', conversationId: null, callId, valid: false
  };
  await service.reconcile();
  await eventually(() => admin.deletions.length === 1);
  assert.deepEqual(admin.deletions, [directRoom]);
});

test('degraded control plane denies tickets and successful reconciliation restores issuance', async (context) => {
  const { service, admin } = harness();
  context.after(() => service.stop());
  admin.failListRooms = true;
  await service.reconcile();
  assert.equal(service.healthy, false);
  await assert.rejects(issue(service), LiveKitControlPlaneUnavailableError);

  admin.failListRooms = false;
  await service.reconcile();
  assert.equal(service.healthy, true);
  await issue(service);
});

test('issued-but-never-connected tokens can only be cancelled locally until LiveKit observes them', async (context) => {
  const { service, events, admin } = harness();
  context.after(() => service.stop());
  await issue(service);
  admin.absent = true;
  events.emitSessionRevoked({ sessionId });
  await eventually(() => service.queuedTaskCount === 0);
  assert.equal(service.healthy, true);
  await assert.rejects(issue(service), VoiceAuthorizationDeniedError);
});

test('database policy resolves groups and accepted direct calls while denying every non-accepted state', async () => {
  const rows: any[][] = [];
  const database = {
    pool: {
      query: async () => ({ rows: rows.shift() ?? [], rowCount: 1 })
    }
  } as unknown as Database;
  const store = createDatabaseVoiceAuthorizationStore(database);

  rows.push([{ kind: 'group', user_low_id: null, user_high_id: null, blocked: false, call_id: null }]);
  assert.equal((await store.resolveScope(userId, conversationId))?.roomName, voiceRoomName(conversationId));

  rows.push([{
    kind: 'direct',
    user_low_id: userId,
    user_high_id: otherUserId,
    blocked: false,
    call_id: callId
  }]);
  assert.equal(
    (await store.resolveScope(userId, conversationId))?.roomName,
    directVoiceRoomName(callId)
  );

  for (const state of ['ringing', 'declined', 'cancelled', 'missed', 'ended', 'interrupted']) {
    rows.push([{
      kind: 'direct',
      user_low_id: userId,
      user_high_id: otherUserId,
      blocked: false,
      call_id: null,
      state
    }]);
    assert.equal(await store.resolveScope(userId, conversationId), null);
  }

  rows.push([{
    kind: 'direct',
    user_low_id: userId,
    user_high_id: otherUserId,
    blocked: true,
    call_id: callId
  }]);
  assert.equal(await store.resolveScope(userId, conversationId), null);
});
