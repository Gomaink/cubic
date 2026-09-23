import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import test from 'node:test';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import type { Database } from '@cubic/database';
import type { SessionService } from '../security/session.js';
import { createOwnedTextChannel } from '../servers/channels.js';
import { conversationRoutes } from './conversations.js';
import { attachmentRoutes } from './attachments.js';
import { serverRoutes } from './servers.js';

const connectionString = process.env.CUBIC_SERVER_TEST_DATABASE_URL
  ?? process.env.CUBIC_GROUP_TEST_DATABASE_URL;

test('server text channels use owner creation, member content access and no legacy membership materialization',
  { skip: !connectionString, timeout: 30_000 }, async () => {
    const pool = new Pool({ connectionString, max: 5 });
    const database = { pool, db: drizzle(pool) } as unknown as Database;
    const ownerId = randomUUID();
    const memberId = randomUUID();
    const outsiderId = randomUUID();
    const serverId = randomUUID();
    const orphanId = randomUUID();
    const attachmentId = randomUUID();
    const storageKey = randomUUID();
    const app = Fastify({ logger: false });
    const suffix = ownerId.replaceAll('-', '').slice(0, 18);
    try {
      for (const [index, id] of [ownerId, memberId, outsiderId].entries()) {
        await pool.query(
          `insert into users (id, email, email_normalized, username, username_normalized, display_name, password_hash)
           values ($1, $2, $2, $3, $3, $4, $5)`,
          [id, `${index}-${suffix}@integration.invalid`, `channel_${index}_${suffix}`, `Channel ${index}`, 'test-only']
        );
      }
      await pool.query('insert into servers (id, name, owner_user_id) values ($1, $2, $3)', [serverId, 'Channels', ownerId]);
      await pool.query('insert into server_members (server_id, user_id) values ($1, $2), ($1, $3)', [serverId, ownerId, memberId]);

      await app.register(cookie);
      app.decorateRequest('auth', null);
      const sessionService = {
        resolveToken: async (token: string) => {
          const id = token === 'owner' ? ownerId : token === 'member' ? memberId : token === 'outsider' ? outsiderId : null;
          return id ? { user: { id } } : null;
        }
      } as SessionService;
      await app.register(serverRoutes, { prefix: '/api/v1/servers', database, cookieName: 'session', sessionService });
      await app.register(conversationRoutes, { prefix: '/api/v1/conversations', database, cookieName: 'session', sessionService });
      await app.register(attachmentRoutes, {
        prefix: '/api/v1', database, cookieName: 'session', sessionService,
        attachmentStore: {
          detectForDelivery: async () => 'text/plain',
          open: () => Readable.from(['content'])
        } as never,
        attachmentMaxBytes: 1024,
        attachmentPendingMaxCount: 20,
        attachmentPendingMaxBytes: 10_000,
        attachmentMinFreeBytes: 1024,
        insertPendingAttachment: (() => { throw new Error('Not used by this test.'); }) as never
      });
      const owner = { cookie: 'session=owner' };
      const member = { cookie: 'session=member' };
      const outsider = { cookie: 'session=outsider' };
      const channelsUrl = `/api/v1/servers/${serverId}/channels`;

      assert.equal((await app.inject({ method: 'POST', url: channelsUrl, payload: { name: 'general' } })).statusCode, 401);
      assert.equal((await app.inject({ method: 'POST', url: channelsUrl, headers: outsider, payload: { name: 'general' } })).statusCode, 404);
      assert.equal((await app.inject({ method: 'POST', url: channelsUrl, headers: member, payload: { name: 'general' } })).statusCode, 403);
      for (const name of ['', '   ', 'x'.repeat(97), 4, null]) {
        assert.equal((await app.inject({ method: 'POST', url: channelsUrl, headers: owner, payload: { name } })).statusCode, 400);
      }
      assert.deepEqual((await app.inject({ method: 'GET', url: channelsUrl, headers: owner })).json(), { channels: [] });
      assert.equal((await app.inject({ method: 'GET', url: channelsUrl, headers: outsider })).statusCode, 404);

      const created = await app.inject({ method: 'POST', url: channelsUrl, headers: owner, payload: { name: '  general  ', ownerUserId: outsiderId } });
      assert.equal(created.statusCode, 201);
      const channel = created.json().channel;
      assert.equal(channel.name, 'general');
      assert.equal(channel.serverId, serverId);
      assert.deepEqual(Object.keys(channel).sort(), ['conversationId', 'createdAt', 'id', 'name', 'serverId', 'updatedAt']);
      assert.equal((await pool.query('select kind, created_by from conversations where id = $1', [channel.conversationId])).rows[0].kind, 'server_text');
      assert.equal((await pool.query('select created_by from conversations where id = $1', [channel.conversationId])).rows[0].created_by, ownerId);
      assert.equal((await pool.query('select count(*)::int as count from conversation_members where conversation_id = $1', [channel.conversationId])).rows[0].count, 0);
      assert.equal((await app.inject({ method: 'POST', url: channelsUrl, headers: owner, payload: { name: 'general' } })).statusCode, 201);
      const listing = (await app.inject({ method: 'GET', url: channelsUrl, headers: member })).json().channels;
      assert.equal(listing.length, 2);
      assert.deepEqual(listing.map((item: { name: string }) => item.name), ['general', 'general']);
      assert.equal((await app.inject({ method: 'GET', url: `/api/v1/conversations/${channel.conversationId}/messages`, headers: outsider })).statusCode, 404);
      assert.equal((await app.inject({ method: 'GET', url: `/api/v1/conversations/${channel.conversationId}/messages`, headers: member })).statusCode, 200);

      const clientMessageId = randomUUID();
      const messagesUrl = `/api/v1/conversations/${channel.conversationId}/messages`;
      const messageBody = { clientMessageId, body: 'Hello channel' };
      assert.equal((await app.inject({ method: 'POST', url: messagesUrl, headers: outsider, payload: messageBody })).statusCode, 404);
      const sent = await app.inject({ method: 'POST', url: messagesUrl, headers: member, payload: messageBody });
      assert.equal(sent.statusCode, 201);
      assert.equal(sent.json().message.body, 'Hello channel');
      const duplicate = await app.inject({ method: 'POST', url: messagesUrl, headers: member, payload: messageBody });
      assert.equal(duplicate.statusCode, 200);
      assert.equal(duplicate.json().duplicate, true);
      assert.equal((await app.inject({ method: 'GET', url: messagesUrl, headers: owner })).json().messages.length, 1);
      const messageId = sent.json().message.id as string;
      assert.equal((await app.inject({ method: 'PUT', url: `${messagesUrl}/${messageId}/reactions`, headers: member, payload: { reaction: '👍' } })).statusCode, 200);
      assert.equal((await app.inject({ method: 'PUT', url: `${messagesUrl}/${messageId}/reactions`, headers: outsider, payload: { reaction: '👍' } })).statusCode, 404);
      await pool.query(
        `insert into attachments (id, conversation_id, uploader_id, message_id, storage_key, original_name, content_type, size_bytes)
         values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [attachmentId, channel.conversationId, memberId, messageId, storageKey, 'channel.txt', 'text/plain', 7]
      );
      const contentUrl = `/api/v1/attachments/${attachmentId}/content`;
      assert.equal((await app.inject({ method: 'GET', url: contentUrl, headers: member })).statusCode, 200);
      assert.equal((await app.inject({ method: 'GET', url: contentUrl, headers: owner })).statusCode, 200);
      assert.equal((await app.inject({ method: 'GET', url: contentUrl, headers: outsider })).statusCode, 404);

      await pool.query('insert into conversations (id, kind) values ($1, $2)', [orphanId, 'server_text']);
      assert.equal((await app.inject({ method: 'GET', url: `/api/v1/conversations/${orphanId}/messages`, headers: owner })).statusCode, 404);
      assert.equal((await app.inject({ method: 'POST', url: `/api/v1/conversations/${orphanId}/messages`, headers: owner, payload: { clientMessageId: randomUUID(), body: 'No mapping' } })).statusCode, 404);

      const before = await pool.query('select count(*)::int as count from conversations where kind = $1 and created_by = $2', ['server_text', ownerId]);
      await assert.rejects(createOwnedTextChannel(database, serverId, ownerId, 'x'.repeat(97)), (error: any) => error.code === '22001');
      const after = await pool.query('select count(*)::int as count from conversations where kind = $1 and created_by = $2', ['server_text', ownerId]);
      assert.equal(after.rows[0].count, before.rows[0].count);
    } finally {
      await app.close();
      await pool.query('delete from server_text_channels where server_id = $1', [serverId]);
      await pool.query('delete from conversations where id = $1 or (kind = $2 and created_by = $3)', [orphanId, 'server_text', ownerId]);
      await pool.query('delete from attachment_file_deletions where storage_key = $1', [storageKey]);
      await pool.query('delete from servers where id = $1', [serverId]);
      await pool.query('delete from users where id = any($1::uuid[])', [[ownerId, memberId, outsiderId]]);
      await pool.end();
    }
  });
