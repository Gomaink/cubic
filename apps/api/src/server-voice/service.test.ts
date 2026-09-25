import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { AccessToken } from 'livekit-server-sdk';
import type { Database } from '@cubic/database';
import type { SessionService } from '../security/session.js';
import { createRealtimeEvents } from '../realtime/events.js';
import { ServerVoiceService } from './service.js';
import { serverVoiceRoomName } from './token.js';
import { roomScopedSessionTag, voiceParticipantIdentity } from '../voice/token.js';

const apiKey = 'VOICE_TEST_KEY';
const apiSecret = 'voice-test-secret-with-more-than-thirty-two-characters';
const channelId = '11111111-1111-4111-8111-111111111111';
const serverId = '22222222-2222-4222-8222-222222222222';

test('only signed LiveKit webhook bodies can trigger server-voice reconciliation', async () => {
  let reads = 0;
  const database = { pool: { query: async () => ({ rows: [{ server_id: serverId }] }) } } as unknown as Database;
  const admin = {
    listRooms: async () => [],
    listParticipants: async () => { reads += 1; return []; },
    removeParticipant: async () => {}
  };
  const service = new ServerVoiceService({ database, sessions: {} as SessionService,
    events: createRealtimeEvents(), apiKey, apiSecret, apiUrl: 'http://unused.invalid',
    publicUrl: 'wss://unused.invalid', admin });
  const body = JSON.stringify({ event: 'participant_joined', room: { name: serverVoiceRoomName(channelId) } });
  await assert.rejects(service.receiveWebhook(body, undefined));
  assert.equal(reads, 0);
  const signature = new AccessToken(apiKey, apiSecret, { ttl: '60s' });
  signature.sha256 = createHash('sha256').update(body).digest('base64');
  const header = await signature.toJwt();
  await service.receiveWebhook(body, header);
  assert.equal(reads, 1);
  await assert.rejects(service.receiveWebhook(body + ' ', header));
  assert.equal(reads, 1);
  const unrelated = JSON.stringify({ event: 'participant_joined', room: { name: 'cubic-voice-' + channelId } });
  const unrelatedSignature = new AccessToken(apiKey, apiSecret, { ttl: '60s' });
  unrelatedSignature.sha256 = createHash('sha256').update(unrelated).digest('base64');
  await service.receiveWebhook(unrelated, await unrelatedSignature.toJwt());
  assert.equal(reads, 1);
  await service.stop();
});

test('reconciliation dedupes two devices, retains the other when one leaves, and evicts a former member', async () => {
  const userId = '33333333-3333-4333-8333-333333333333';
  const sessionId = '44444444-4444-4444-8444-444444444444';
  const room = serverVoiceRoomName(channelId);
  const tag = roomScopedSessionTag(apiSecret, room, sessionId);
  const make = (instanceId: string) => ({
    identity: voiceParticipantIdentity(tag, instanceId),
    attributes: { cubicUserId: userId, cubicServerVoiceChannelId: channelId }
  });
  let current = [make('55555555-5555-4555-8555-555555555551'), make('55555555-5555-4555-8555-555555555552')];
  let isMember = true;
  const removed: string[] = [];
  const database = { pool: { query: async (sql: string) => {
    if (sql.includes('from server_voice_channels voice')) return { rows: [{ server_id: serverId }], rowCount: 1 };
    if (sql.includes('from server_members')) return { rows: isMember ? [{}] : [], rowCount: isMember ? 1 : 0 };
    if (sql.includes('from users')) return { rows: [{ display_name: 'Member' }], rowCount: 1 };
    throw new Error('Unexpected fixture query');
  } } } as unknown as Database;
  const sessions = {
    listActiveForUser: async () => [{ id: sessionId }],
    validateId: async () => ({ user: { id: userId } })
  } as unknown as SessionService;
  const events = createRealtimeEvents();
  const changes: number[] = [];
  events.onServerVoicePresence((event) => changes.push(event.occupants.length));
  const admin = {
    listRooms: async () => [{ name: room }],
    listParticipants: async () => current,
    removeParticipant: async (_room: string, identity: string) => {
      removed.push(identity);
      current = current.filter((item) => item.identity !== identity);
    }
  };
  const service = new ServerVoiceService({ database, sessions, events,
    apiKey, apiSecret, apiUrl: 'http://unused.invalid', publicUrl: 'wss://unused.invalid', admin });
  await service.reconcile();
  assert.equal(service.snapshot(serverId)[0]?.occupants.length, 1);
  current = current.slice(1);
  await service.reconcile();
  assert.equal(service.snapshot(serverId)[0]?.occupants.length, 1);
  isMember = false;
  await service.reconcile();
  assert.equal(service.snapshot(serverId).length, 0);
  assert.equal(removed.length, 1);
  assert.deepEqual(changes, [1, 0]);
  await service.stop();
});

test('reconciliation clears stale occupancy when a voice channel fails canonical lookup', async () => {
  const userId = '33333333-3333-4333-8333-333333333333';
  const sessionId = '44444444-4444-4444-8444-444444444444';
  const room = serverVoiceRoomName(channelId);
  const participant = {
    identity: voiceParticipantIdentity(roomScopedSessionTag(apiSecret, room, sessionId),
      '55555555-5555-4555-8555-555555555551'),
    attributes: { cubicUserId: userId, cubicServerVoiceChannelId: channelId }
  };
  let validChannel = true;
  let current = [participant];
  const removed: string[] = [];
  const database = { pool: { query: async (sql: string) => {
    if (sql.includes('from server_voice_channels voice')) return { rows: validChannel ? [{ server_id: serverId }] : [] };
    if (sql.includes('from server_members')) return { rows: [{}], rowCount: 1 };
    if (sql.includes('from users')) return { rows: [{ display_name: 'Member' }], rowCount: 1 };
    throw new Error('Unexpected fixture query');
  } } } as unknown as Database;
  const sessions = { listActiveForUser: async () => [{ id: sessionId }],
    validateId: async () => ({ user: { id: userId } }) } as unknown as SessionService;
  const events = createRealtimeEvents();
  const changes: number[] = [];
  events.onServerVoicePresence((event) => changes.push(event.occupants.length));
  const admin = { listRooms: async () => [{ name: room }], listParticipants: async () => current,
    removeParticipant: async (_room: string, identity: string) => {
      removed.push(identity);
      current = current.filter((item) => item.identity !== identity);
    } };
  const service = new ServerVoiceService({ database, sessions, events,
    apiKey, apiSecret, apiUrl: 'http://unused.invalid', publicUrl: 'wss://unused.invalid', admin });
  await service.reconcile();
  validChannel = false;
  await service.reconcile();
  assert.equal(service.snapshot(serverId).length, 0);
  assert.equal(removed.length, 1);
  assert.deepEqual(changes, [1, 0]);
  await service.stop();
});

test('overlapping signed events cannot leave an older presence snapshot applied last', async () => {
  const userId = '33333333-3333-4333-8333-333333333333';
  const sessionId = '44444444-4444-4444-8444-444444444444';
  const room = serverVoiceRoomName(channelId);
  const participant = {
    identity: voiceParticipantIdentity(roomScopedSessionTag(apiSecret, room, sessionId),
      '55555555-5555-4555-8555-555555555551'),
    attributes: { cubicUserId: userId, cubicServerVoiceChannelId: channelId }
  };
  let firstRead!: () => void;
  let releaseFirst!: () => void;
  const entered = new Promise<void>((resolve) => { firstRead = resolve; });
  const release = new Promise<void>((resolve) => { releaseFirst = resolve; });
  let reads = 0;
  const admin = { listRooms: async () => [{ name: room }],
    listParticipants: async () => {
      reads += 1;
      if (reads === 1) { firstRead(); await release; return [participant]; }
      return [];
    },
    removeParticipant: async () => {} };
  const database = { pool: { query: async (sql: string) => {
    if (sql.includes('from server_voice_channels voice')) return { rows: [{ server_id: serverId }] };
    if (sql.includes('from server_members')) return { rows: [{}], rowCount: 1 };
    if (sql.includes('from users')) return { rows: [{ display_name: 'Member' }], rowCount: 1 };
    throw new Error('Unexpected fixture query');
  } } } as unknown as Database;
  const sessions = { listActiveForUser: async () => [{ id: sessionId }],
    validateId: async () => ({ user: { id: userId } }) } as unknown as SessionService;
  const service = new ServerVoiceService({ database, sessions, events: createRealtimeEvents(),
    apiKey, apiSecret, apiUrl: 'http://unused.invalid', publicUrl: 'wss://unused.invalid', admin });
  const body = JSON.stringify({ event: 'participant_joined', room: { name: room } });
  const signature = new AccessToken(apiKey, apiSecret, { ttl: '60s' });
  signature.sha256 = createHash('sha256').update(body).digest('base64');
  const header = await signature.toJwt();
  const first = service.receiveWebhook(body, header);
  await entered;
  const second = service.receiveWebhook(body, header);
  releaseFirst();
  await Promise.all([first, second]);
  assert.equal(reads, 2);
  assert.equal(service.snapshot(serverId).length, 0);
  await service.stop();
});
