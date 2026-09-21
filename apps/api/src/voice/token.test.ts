import assert from 'node:assert/strict';
import test from 'node:test';
import { TokenVerifier } from 'livekit-server-sdk';
import {
  VOICE_TOKEN_TTL_SECONDS,
  createVoiceJoinToken,
  directVoiceRoomName,
  parseVoiceParticipantIdentity,
  roomScopedSessionTag,
  voiceRoomName
} from './token.js';

const apiKey = 'CUBIC_TEST_KEY';
const apiSecret = 'cubic-test-secret-that-is-longer-than-thirty-two-characters';

test('voiceRoomName is deterministic', () => {
  assert.equal(
    voiceRoomName('0218d498-94f5-4ae6-8049-82ea4afa53a4'),
    'cubic-voice-0218d498-94f5-4ae6-8049-82ea4afa53a4'
  );
  assert.equal(
    directVoiceRoomName('44444444-4444-4444-8444-444444444444'),
    'cubic-voice-direct-44444444-4444-4444-8444-444444444444'
  );
});

test('media token is scoped to one room and approved media publishing', async () => {
  const ticket = await createVoiceJoinToken({
    apiKey,
    apiSecret,
    publicUrl: 'wss://voice.example.test',
    roomName: voiceRoomName('11111111-1111-4111-8111-111111111111'),
    conversationId: '11111111-1111-4111-8111-111111111111',
    userId: '22222222-2222-4222-8222-222222222222',
    displayName: 'Samuel',
    sessionId: '55555555-5555-4555-8555-555555555555',
    participantInstanceId: '33333333-3333-4333-8333-333333333333'
  });

  const claims = await new TokenVerifier(apiKey, apiSecret).verify(ticket.token);

  assert.equal(claims.sub, ticket.participantIdentity);
  assert.equal(claims.video?.roomJoin, true);
  assert.equal(claims.video?.room, ticket.roomName);
  assert.equal(claims.video?.canSubscribe, true);
  assert.equal(claims.video?.canPublishData, false);
  assert.equal(claims.video?.canUpdateOwnMetadata, false);
  assert.deepEqual(claims.video?.canPublishSources, [
    'microphone',
    'camera',
    'screen_share',
    'screen_share_audio'
  ]);
  assert.equal(claims.attributes?.cubicUserId, '22222222-2222-4222-8222-222222222222');
  assert.deepEqual(Object.keys(claims.attributes ?? {}).sort(), [
    'cubicConversationId',
    'cubicUserId'
  ]);
  assert.equal(Number(claims.exp) - Number(claims.nbf), VOICE_TOKEN_TTL_SECONDS);

  const parsedIdentity = parseVoiceParticipantIdentity(ticket.participantIdentity);
  assert.ok(parsedIdentity);
  assert.equal(parsedIdentity.participantInstanceId, '33333333-3333-4333-8333-333333333333');
  assert.doesNotMatch(ticket.participantIdentity, /55555555-5555-4555-8555-555555555555/);
  assert.doesNotMatch(JSON.stringify(claims), /55555555-5555-4555-8555-555555555555/);
  assert.doesNotMatch(JSON.stringify(claims), /test-secret|tokenHash|clientLabel/i);
});

test('opaque session tags vary by session and room while instances remain independent', () => {
  const roomA = voiceRoomName('11111111-1111-4111-8111-111111111111');
  const roomB = voiceRoomName('11111111-1111-4111-8111-111111111112');
  const sessionA = '55555555-5555-4555-8555-555555555555';
  const sessionB = '55555555-5555-4555-8555-555555555556';

  const first = roomScopedSessionTag(apiSecret, roomA, sessionA);
  assert.equal(first, roomScopedSessionTag(apiSecret, roomA, sessionA));
  assert.notEqual(first, roomScopedSessionTag(apiSecret, roomA, sessionB));
  assert.notEqual(first, roomScopedSessionTag(apiSecret, roomB, sessionA));
  assert.equal(first.length, 22);
});
