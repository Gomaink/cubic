import assert from 'node:assert/strict';
import test from 'node:test';
import cookie from '@fastify/cookie';
import Fastify from 'fastify';
import type { SessionService } from '../security/session.js';
import {
  LiveKitControlPlaneUnavailableError,
  VoiceAuthorizationDeniedError,
  type LiveKitAuthorizationService
} from '../voice/authorization.js';
import { voiceRoutes } from './voice.js';

const conversationId = '20000000-0000-4000-8000-000000000001';
const sessionId = '60000000-0000-4000-8000-000000000001';

function sessionService() {
  return {
    async resolveToken(token: string) {
      if (token !== 'valid') return null;
      return {
        sessionId,
        expiresAt: new Date(Date.now() + 60_000),
        user: {
          id: '10000000-0000-4000-8000-000000000001',
          username: 'user',
          displayName: 'User',
          avatarUrl: null,
          createdAt: '2026-01-01T00:00:00.000Z'
        }
      };
    }
  } as unknown as SessionService;
}

async function createHarness(issueJoinTicket: (input: unknown) => Promise<unknown>) {
  const app = Fastify({ logger: false });
  await app.register(cookie);
  app.decorateRequest('auth', null);
  await app.register(voiceRoutes, {
    prefix: '/api/v1/voice',
    cookieName: 'session',
    sessionService: sessionService(),
    livekitAuthorization: { issueJoinTicket } as unknown as LiveKitAuthorizationService
  });
  await app.ready();
  return app;
}

test('voice route passes only server-authenticated identity to issuance', async (context) => {
  let received: any;
  const app = await createHarness(async (input) => {
    received = input;
    return {
      url: 'wss://livekit.test',
      token: 'media-capability',
      roomName: 'cubic-voice-test',
      participantIdentity: 'cubic-v1.tag.instance'
    };
  });
  context.after(() => app.close());

  const response = await app.inject({
    method: 'POST',
    url: `/api/v1/voice/conversations/${conversationId}/token`,
    cookies: { session: 'valid' },
    payload: {
      userId: 'attacker-controlled',
      sessionId: 'attacker-controlled',
      callId: 'attacker-controlled',
      roomName: 'attacker-controlled'
    }
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(received, {
    sessionId,
    userId: '10000000-0000-4000-8000-000000000001',
    displayName: 'User',
    conversationId
  });
});

test('voice authorization denials are uniform and degraded control plane returns generic 503', async (context) => {
  const denied = await createHarness(async () => { throw new VoiceAuthorizationDeniedError(); });
  const degraded = await createHarness(async () => {
    throw new LiveKitControlPlaneUnavailableError();
  });
  context.after(async () => {
    await denied.close();
    await degraded.close();
  });

  const deniedResponse = await denied.inject({
    method: 'POST',
    url: `/api/v1/voice/conversations/${conversationId}/token`,
    cookies: { session: 'valid' }
  });
  assert.equal(deniedResponse.statusCode, 403);
  assert.deepEqual(deniedResponse.json(), { error: 'Voice is unavailable.' });

  const degradedResponse = await degraded.inject({
    method: 'POST',
    url: `/api/v1/voice/conversations/${conversationId}/token`,
    cookies: { session: 'valid' }
  });
  assert.equal(degradedResponse.statusCode, 503);
  assert.deepEqual(degradedResponse.json(), {
    error: 'Voice service is temporarily unavailable.'
  });
});
