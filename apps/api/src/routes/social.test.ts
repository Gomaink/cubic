import assert from 'node:assert/strict';
import test from 'node:test';
import cookie from '@fastify/cookie';
import Fastify from 'fastify';
import type { Database } from '@cubic/database';
import type { SessionService } from '../security/session.js';
import { createRealtimeEvents } from '../realtime/events.js';
import { socialRoutes } from './social.js';

function resolvedBuilder(value: unknown = []) {
  const promise = Promise.resolve(value);
  const builder: any = {
    values: () => builder,
    onConflictDoNothing: () => promise,
    where: () => promise,
    set: () => builder,
    from: () => builder,
    leftJoin: () => builder,
    then: promise.then.bind(promise)
  };
  return builder;
}

test('blocking emits a server-resolved post-commit direct authorization event', async (context) => {
  const blockerId = '10000000-0000-4000-8000-000000000001';
  const blockedId = '10000000-0000-4000-8000-000000000002';
  const conversationId = '20000000-0000-4000-8000-000000000001';
  const callId = '30000000-0000-4000-8000-000000000001';
  let committed = false;
  const tx = {
    insert: () => resolvedBuilder(),
    delete: () => resolvedBuilder(),
    update: () => resolvedBuilder(),
    select: () => resolvedBuilder([{ conversationId, callId }])
  };
  const database = {
    db: {
      transaction: async (action: (value: typeof tx) => Promise<void>) => {
        const result = await action(tx);
        committed = true;
        return result;
      }
    },
    pool: {}
  } as unknown as Database;
  const sessionService = {
    async resolveToken() {
      return {
        sessionId: '60000000-0000-4000-8000-000000000001',
        expiresAt: new Date(Date.now() + 60_000),
        user: {
          id: blockerId,
          username: 'blocker',
          displayName: 'Blocker',
          avatarUrl: null,
          createdAt: '2026-01-01T00:00:00.000Z'
        }
      };
    }
  } as unknown as SessionService;
  const events = createRealtimeEvents();
  const received = new Promise<any>((resolve) => {
    events.onDirectBlocked((event) => resolve({ event, committed }));
  });
  const app = Fastify({ logger: false });
  await app.register(cookie);
  app.decorateRequest('auth', null);
  await app.register(socialRoutes, {
    database,
    cookieName: 'session',
    sessionService,
    realtimeEvents: events
  });
  context.after(() => app.close());

  const response = await app.inject({
    method: 'POST',
    url: '/blocks',
    cookies: { session: 'valid' },
    payload: { userId: blockedId }
  });
  assert.equal(response.statusCode, 201, response.body);
  assert.deepEqual(await received, {
    committed: true,
    event: { conversationId, blockerId, blockedId, callId }
  });
});
