import { randomUUID } from 'node:crypto';
import { AccessToken, TrackSource } from 'livekit-server-sdk';
import { roomScopedSessionTag, voiceParticipantIdentity } from '../voice/token.js';

export const SERVER_VOICE_TOKEN_TTL_SECONDS = 60;
const ROOM_PREFIX = 'cubic-server-voice-';
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const ROOM_PATTERN = new RegExp(`^${ROOM_PREFIX}(${UUID})$`, 'i');

export function serverVoiceRoomName(channelId: string): string {
  return `${ROOM_PREFIX}${channelId}`;
}

export function parseServerVoiceRoomName(roomName: string): string | null {
  return ROOM_PATTERN.exec(roomName)?.[1] ?? null;
}

export async function createServerVoiceToken(input: {
  apiKey: string;
  apiSecret: string;
  publicUrl: string;
  channelId: string;
  userId: string;
  displayName: string;
  sessionId: string;
}) {
  const roomName = serverVoiceRoomName(input.channelId);
  const identity = voiceParticipantIdentity(
    roomScopedSessionTag(input.apiSecret, roomName, input.sessionId), randomUUID()
  );
  const accessToken = new AccessToken(input.apiKey, input.apiSecret, {
    identity,
    name: input.displayName,
    ttl: `${SERVER_VOICE_TOKEN_TTL_SECONDS}s`,
    attributes: {
      cubicUserId: input.userId,
      cubicServerVoiceChannelId: input.channelId
    }
  });
  accessToken.addGrant({
    roomJoin: true,
    room: roomName,
    canSubscribe: true,
    canPublish: true,
    canPublishData: false,
    canUpdateOwnMetadata: false,
    canPublishSources: [
      TrackSource.MICROPHONE,
      TrackSource.CAMERA,
      TrackSource.SCREEN_SHARE,
      TrackSource.SCREEN_SHARE_AUDIO
    ]
  });
  return { url: input.publicUrl, token: await accessToken.toJwt(), identity };
}
