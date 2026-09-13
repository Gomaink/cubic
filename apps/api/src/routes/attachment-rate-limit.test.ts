import assert from 'node:assert/strict';
import test from 'node:test';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';
import { attachmentRoutes } from './attachments.js';

const userId = '10000000-0000-4000-8000-000000000001';
const conversationId = '20000000-0000-4000-8000-000000000001';

async function rateLimitApp() {
  const app = Fastify({ logger: false });
  await app.register(cookie);
  await app.register(multipart);
  await app.register(rateLimit, { global: true, max: 300, timeWindow: 60_000 });
  app.decorateRequest('auth', null);

  const database = {
    db: {
      select: () => {
        const builder: any = {
          from: () => builder,
          innerJoin: () => builder,
          where: () => builder,
          limit: async () => [{
            session: {
              id: '60000000-0000-4000-8000-000000000001',
              lastSeenAt: new Date(),
              expiresAt: new Date(Date.now() + 60_000)
            },
            user: {
              id: userId,
              username: 'uploader',
              displayName: 'Uploader',
              avatarUrl: null,
              createdAt: new Date(),
              disabledAt: null
            }
          }]
        };
        return builder;
      }
    },
    pool: {
      query: async (sql: string) => {
        const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();
        if (normalized.includes('from conversation_members')) {
          return { rows: [{}], rowCount: 1 };
        }
        if (normalized.includes('from direct_conversation_pairs dp')) {
          return { rows: [], rowCount: 0 };
        }
        throw new Error(`Unexpected rate-limit fixture SQL: ${normalized}`);
      }
    }
  };

  await app.register(attachmentRoutes, {
    database: database as never,
    cookieName: 'session',
    attachmentStore: {
      assertFreeSpace: async () => {},
      delete: async () => {}
    } as never,
    attachmentMaxBytes: 1024,
    attachmentPendingMaxCount: 20,
    attachmentPendingMaxBytes: 10_000,
    attachmentMinFreeBytes: 1024,
    uploadRateLimit: app.rateLimit({
      max: 1,
      timeWindow: 60_000,
      groupId: 'attachment-upload',
      keyGenerator: (request) => request.auth?.user.id ?? request.ip
    }),
    insertPendingAttachment: async () => { throw new Error('must not insert'); }
  });
  await app.ready();
  return app;
}

test('attachment upload has normal 429 semantics keyed by authenticated user, not IP', async (context) => {
  const app = await rateLimitApp();
  context.after(() => app.close());

  const unauthenticated = await app.inject({
    method: 'POST',
    url: `/conversations/${conversationId}/attachments`
  });
  assert.equal(unauthenticated.statusCode, 401);

  const first = await app.inject({
    method: 'POST',
    url: `/conversations/${conversationId}/attachments`,
    remoteAddress: '198.51.100.10',
    headers: { cookie: 'session=valid' }
  });
  const retryFromAnotherIp = await app.inject({
    method: 'POST',
    url: `/conversations/${conversationId}/attachments`,
    remoteAddress: '198.51.100.99',
    headers: { cookie: 'session=valid' }
  });

  assert.equal(first.statusCode, 400);
  assert.equal(retryFromAnotherIp.statusCode, 429);
  assert.equal(retryFromAnotherIp.json().error, 'Too Many Requests');
  assert.ok(Number(retryFromAnotherIp.headers['retry-after']) > 0);
});
