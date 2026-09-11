import { randomUUID } from 'node:crypto';
import { AccessToken, TrackSource } from 'livekit-server-sdk';

export interface CreateVoiceJoinTokenOptions {
  apiKey: string;
  apiSecret: string;
  publicUrl: string;
  conversationId: string;
  userId: string;
  displayName: string;
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

export async function createVoiceJoinToken(
  options: CreateVoiceJoinTokenOptions
): Promise<VoiceJoinTicket> {
  const roomName = voiceRoomName(options.conversationId);
  const instanceId = options.participantInstanceId ?? randomUUID();
  const participantIdentity = `${options.userId}.${instanceId}`;

  const accessToken = new AccessToken(options.apiKey, options.apiSecret, {
    identity: participantIdentity,
    name: options.displayName,
    ttl: '10m',
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
