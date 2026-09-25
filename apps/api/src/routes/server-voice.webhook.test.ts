import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import Fastify from 'fastify';
import { AccessToken } from 'livekit-server-sdk';
import type { Database } from '@cubic/database';
import type { SessionService } from '../security/session.js';
import { createBrowserMutationProtection } from '../security/browser-request.js';
import { createRealtimeEvents } from '../realtime/events.js';
import { roomScopedSessionTag, voiceParticipantIdentity } from '../voice/token.js';
import { ServerVoiceService } from '../server-voice/service.js';
import { serverVoiceRoomName } from '../server-voice/token.js';
import { serverVoiceWebhookRoutes } from './server-voice.js';

const apiKey = 'WEBHOOK_TEST_KEY';
const apiSecret = 'webhook-test-secret-longer-than-thirty-two-characters';
const serverId = '22222222-2222-4222-8222-222222222222';
const channelId = '11111111-1111-4111-8111-111111111111';
const otherChannelId = '66666666-6666-4666-8666-666666666666';
const memberId = '33333333-3333-4333-8333-333333333333';
const outsiderId = '77777777-7777-4777-8777-777777777777';
const sessionId = '44444444-4444-4444-8444-444444444444';
const room = serverVoiceRoomName(channelId);

async function signed(body: string, secret = apiSecret) {
  const token = new AccessToken(apiKey, secret, { ttl: '60s' });
  token.sha256 = createHash('sha256').update(body).digest('base64');
  return token.toJwt();
}

test('HTTP LiveKit webhook requires a valid raw-body signature and reconciles canonical occupancy only', async () => {
  const app = Fastify({ logger: false });
  const events = createRealtimeEvents();
  const changes: number[] = [];
  events.onServerVoicePresence((event) => changes.push(event.occupants.length));
  let participants = [{
    identity: voiceParticipantIdentity(roomScopedSessionTag(apiSecret, room, sessionId),
      '55555555-5555-4555-8555-555555555551'),
    attributes: { cubicUserId: memberId, cubicServerVoiceChannelId: channelId }
  }];
  const removed: string[] = [];
  let participantReads = 0;
  const admin = {
    listRooms: async () => [{ name: room }],
    listParticipants: async () => { participantReads += 1; return participants; },
    removeParticipant: async (_room: string, identity: string) => {
      removed.push(identity);
      participants = participants.filter((item) => item.identity !== identity);
    }
  };
  const database = { pool: { query: async (sql: string, params: unknown[]) => {
    if (sql.includes('from server_voice_channels voice'))
      return { rows: params[0] === channelId ? [{ server_id: serverId }] : [], rowCount: params[0] === channelId ? 1 : 0 };
    if (sql.includes('from server_members'))
      return { rows: params[1] === memberId ? [{}] : [], rowCount: params[1] === memberId ? 1 : 0 };
    if (sql.includes('from users')) return { rows: [{ display_name: 'Member' }], rowCount: 1 };
    throw new Error('Unexpected fixture query');
  } } } as unknown as Database;
  const sessions = {
    listActiveForUser: async (userId: string) => userId === memberId ? [{ id: sessionId }] : [],
    validateId: async (id: string) => id === sessionId ? { user: { id: memberId } } : null
  } as unknown as SessionService;
  const service = new ServerVoiceService({ database, sessions, events, apiKey, apiSecret,
    apiUrl: 'http://unused.invalid', publicUrl: 'wss://unused.invalid', admin });
  app.addHook('onRequest', createBrowserMutationProtection('https://cubic.example'));
  await app.register(serverVoiceWebhookRoutes, { prefix: '/api/v1/server-voice', service });
  const post = (body: string, authorization?: string) => app.inject({
    method: 'POST', url: '/api/v1/server-voice/webhook',
    headers: { 'content-type': 'application/webhook+json', ...(authorization ? { authorization } : {}) },
    payload: body
  });
  const assertNoSecret = (body: string) => {
    assert.equal(body.includes(apiSecret), false);
    assert.equal(body.includes('fixture-ticket'), false);
  };
  try {
    const joined = JSON.stringify({ event: 'participant_joined', room: { name: room },
      participant: { identity: 'untrusted-event-identity', attributes: { cubicUserId: outsiderId } } });
    const accepted = await post(joined, await signed(joined));
    assert.equal(accepted.statusCode, 204, accepted.body);
    assert.deepEqual(service.snapshot(serverId)[0]?.occupants, [{ userId: memberId, displayName: 'Member' }]);
    assert.deepEqual(changes, [1]);
    assert.equal(participantReads, 1);

    for (const rejected of [
      await post(joined),
      await post(joined, 'not-a-jwt'),
      await post(joined, await signed(joined, 'wrong-secret-longer-than-thirty-two-characters')),
      await post(joined + ' ', await signed(joined)),
      await post('{', await signed('{')),
      await post('{}', await signed('{}'))
    ]) {
      assert.equal(rejected.statusCode, 401, rejected.body);
      assertNoSecret(rejected.body);
    }
    assert.equal(participantReads, 1, 'rejected input must not reach LiveKit reconciliation');
    assert.deepEqual(changes, [1]);

    const unsupported = JSON.stringify({ event: 'room_started', room: { name: room } });
    assert.equal((await post(unsupported, await signed(unsupported))).statusCode, 204);
    const unrelated = JSON.stringify({ event: 'participant_joined', room: { name: 'cubic-voice-' + channelId } });
    assert.equal((await post(unrelated, await signed(unrelated))).statusCode, 204);
    assert.equal(participantReads, 1);
    assert.deepEqual(changes, [1]);

    // A signed event cannot confer membership: occupancy comes from the
    // canonical room's current admin participants plus DB/session authority.
    participants = [{ ...participants[0]!, attributes: { cubicUserId: outsiderId,
      cubicServerVoiceChannelId: channelId } }];
    assert.equal((await post(joined, await signed(joined))).statusCode, 204);
    assert.equal(service.snapshot(serverId).length, 0);
    assert.equal(removed.length, 1);
    assert.deepEqual(changes, [1, 0]);

    const foreignRoom = serverVoiceRoomName(otherChannelId);
    participants = [{ ...participants[0]!, identity: 'untrusted-foreign-identity',
      attributes: { cubicUserId: memberId, cubicServerVoiceChannelId: otherChannelId } }];
    const substituted = JSON.stringify({ event: 'participant_joined', room: { name: foreignRoom } });
    assert.equal((await post(substituted, await signed(substituted))).statusCode, 204);
    assert.equal(removed.length, 2);
    assert.equal(service.snapshot(serverId).length, 0);
  } finally {
    await app.close();
    await service.stop();
  }
});
