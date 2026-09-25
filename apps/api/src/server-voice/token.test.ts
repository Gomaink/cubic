import assert from 'node:assert/strict';
import test from 'node:test';
import { TokenVerifier } from 'livekit-server-sdk';
import { createServerVoiceToken, parseServerVoiceRoomName, serverVoiceRoomName, SERVER_VOICE_TOKEN_TTL_SECONDS } from './token.js';

const apiKey = 'VOICE_TEST_KEY';
const apiSecret = 'voice-test-secret-with-more-than-thirty-two-characters';
const channelId = '11111111-1111-4111-8111-111111111111';

test('server voice room identity is deterministic and rejects unrelated rooms', () => {
  assert.equal(parseServerVoiceRoomName(serverVoiceRoomName(channelId)), channelId);
  assert.equal(parseServerVoiceRoomName('cubic-voice-' + channelId), null);
  assert.equal(parseServerVoiceRoomName('cubic-server-voice-not-a-uuid'), null);
});

test('server voice token is a 60-second, room-scoped capability for the four approved media sources', async () => {
  const ticket = await createServerVoiceToken({
    apiKey, apiSecret, publicUrl: 'wss://voice.example.invalid',
    channelId, userId: '22222222-2222-4222-8222-222222222222',
    displayName: 'Member', sessionId: '33333333-3333-4333-8333-333333333333'
  });
  const claims = await new TokenVerifier(apiKey, apiSecret).verify(ticket.token);
  assert.equal(ticket.url, 'wss://voice.example.invalid');
  assert.equal(claims.video?.room, serverVoiceRoomName(channelId));
  assert.equal(claims.video?.roomJoin, true);
  assert.equal(claims.video?.canSubscribe, true);
  assert.equal(claims.video?.canPublish, true);
  assert.equal(claims.video?.canPublishData, false);
  assert.equal(claims.video?.canUpdateOwnMetadata, false);
  assert.notEqual(claims.video?.roomAdmin, true);
  assert.notEqual(claims.video?.roomCreate, true);
  assert.notEqual(claims.video?.roomList, true);
  assert.notEqual(claims.video?.roomRecord, true);
  assert.deepEqual(claims.video?.canPublishSources, ['microphone', 'camera', 'screen_share', 'screen_share_audio']);
  assert.equal(Number(claims.exp) - Number(claims.nbf), SERVER_VOICE_TOKEN_TTL_SECONDS);
  assert.equal(claims.attributes?.cubicServerVoiceChannelId, channelId);
  assert.doesNotMatch(JSON.stringify(claims), /33333333-3333-4333-8333-333333333333|voice-test-secret/);
});
