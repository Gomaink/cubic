import { createHmac, randomUUID } from 'node:crypto';
import { AccessToken, TrackSource } from 'livekit-server-sdk';

export const VOICE_TOKEN_TTL_SECONDS = 10 * 60;
const PARTICIPANT_IDENTITY_VERSION = 'cubic-v1';
const SESSION_TAG_DOMAIN = 'cubic-livekit-session-v1\0';

export interface CreateVoiceJoinTokenOptions {
  apiKey: string;
  apiSecret: string;
  publicUrl: string;
  roomName: string;
  conversationId: string;
  userId: string;
  displayName: string;
  sessionId: string;
  participantInstanceId?: string;
}

export interface VoiceJoinTicket {
  url: string;
  token: string;
  roomName: string;
  participantIdentity: string;
}

export function voiceRoomName(conversationId: string): string {
  return `cubic-voice-${conversationId}`;
}

export function directVoiceRoomName(callId: string): string {
  return `cubic-voice-direct-${callId}`;
}

export function roomScopedSessionTag(
  apiSecret: string,
  roomName: string,
  sessionId: string
): string {
  return createHmac('sha256', apiSecret)
    .update(SESSION_TAG_DOMAIN)
    .update(roomName)
    .update('\0')
    .update(sessionId)
    .digest()
    .subarray(0, 16)
    .toString('base64url');
}

export function voiceParticipantIdentity(
  sessionTag: string,
  participantInstanceId: string
): string {
  return `${PARTICIPANT_IDENTITY_VERSION}.${sessionTag}.${participantInstanceId}`;
}

export interface ParsedVoiceParticipantIdentity {
  sessionTag: string;
  participantInstanceId: string;
}

export function parseVoiceParticipantIdentity(
  identity: string
): ParsedVoiceParticipantIdentity | null {
  const match = /^cubic-v1\.([A-Za-z0-9_-]{22})\.([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i.exec(identity);
  if (!match) return null;
  return { sessionTag: match[1]!, participantInstanceId: match[2]! };
}

export async function createVoiceJoinToken(
  options: CreateVoiceJoinTokenOptions
): Promise<VoiceJoinTicket> {
  const roomName = options.roomName;
  const instanceId = options.participantInstanceId ?? randomUUID();
  const sessionTag = roomScopedSessionTag(
    options.apiSecret,
    roomName,
    options.sessionId
  );
  const participantIdentity = voiceParticipantIdentity(sessionTag, instanceId);

  const accessToken = new AccessToken(options.apiKey, options.apiSecret, {
    identity: participantIdentity,
    name: options.displayName,
    ttl: `${VOICE_TOKEN_TTL_SECONDS}s`,
    attributes: {
      cubicUserId: options.userId,
      cubicConversationId: options.conversationId
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

  return {
    url: options.publicUrl,
    token: await accessToken.toJwt(),
    roomName,
    participantIdentity
  };
}
