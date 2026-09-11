import assert from 'node:assert/strict';
import test from 'node:test';
import { TokenVerifier } from 'livekit-server-sdk';
import { createVoiceJoinToken, voiceRoomName } from './token.js';

const apiKey = 'CUBIC_TEST_KEY';
const apiSecret = 'cubic-test-secret-that-is-longer-than-thirty-two-characters';

test('voiceRoomName is deterministic', () => {
  assert.equal(
    voiceRoomName('0218d498-94f5-4ae6-8049-82ea4afa53a4'),
    'cubic-voice-0218d498-94f5-4ae6-8049-82ea4afa53a4'
  );
});

test('media token is scoped to one room and approved media publishing', async () => {
  const ticket = await createVoiceJoinToken({
    apiKey,
    apiSecret,
    publicUrl: 'wss://voice.example.test',
    conversationId: '11111111-1111-4111-8111-111111111111',
    userId: '22222222-2222-4222-8222-222222222222',
    displayName: 'Samuel',
    participantInstanceId: '33333333-3333-4333-8333-333333333333'
  });

  const claims = await new TokenVerifier(apiKey, apiSecret).verify(ticket.token);

  assert.equal(claims.sub, ticket.participantIdentity);
  assert.equal(claims.video?.roomJoin, true);
  assert.equal(claims.video?.room, ticket.roomName);
  assert.equal(claims.video?.canSubscribe, true);
  assert.equal(claims.video?.canPublishData, false);
  assert.deepEqual(claims.video?.canPublishSources, [
    'microphone',
    'camera',
    'screen_share',
    'screen_share_audio'
  ]);
  assert.equal(claims.attributes?.cubicUserId, '22222222-2222-4222-8222-222222222222');
});
