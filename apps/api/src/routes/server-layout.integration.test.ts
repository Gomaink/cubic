import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import type { Database } from '@cubic/database';
import type { SessionService } from '../security/session.js';
import { serverRoutes } from './servers.js';

const connectionString = process.env.CUBIC_SERVER_TEST_DATABASE_URL ?? process.env.CUBIC_GROUP_TEST_DATABASE_URL;

test('server layout serializes owner mutations and preserves channel content on category delete',
  { skip: !connectionString, timeout: 60_000 }, async () => {
    const pool = new Pool({ connectionString, max: 8 });
    const database = { pool, db: drizzle(pool) } as unknown as Database;
    const app = Fastify({ logger: false });
    const ownerId = randomUUID();
    const memberId = randomUUID();
    const outsiderId = randomUUID();
    const serverId = randomUUID();
    const otherServerId = randomUUID();
    const suffix = ownerId.replaceAll('-', '').slice(0, 18);
    try {
      for (const [index, id] of [ownerId, memberId, outsiderId].entries()) {
        await pool.query(
          `insert into users(id,email,email_normalized,username,username_normalized,display_name,password_hash)
           values($1,$2,$2,$3,$3,$4,'test-only')`,
          [id, `${index}-${suffix}@integration.invalid`, `layout_${index}_${suffix}`, `Layout ${index}`]
        );
      }
      await pool.query('insert into servers(id,name,owner_user_id) values($1,$3,$2),($4,$3,$2)', [serverId, ownerId, 'Layout', otherServerId]);
      await pool.query('insert into server_members(server_id,user_id) values($1,$2),($1,$3),($4,$2)', [serverId, ownerId, memberId, otherServerId]);
      await app.register(cookie);
      app.decorateRequest('auth', null);
      const sessionService = { resolveToken: async (token: string) => {
        const id = token === 'owner' ? ownerId : token === 'member' ? memberId : token === 'outsider' ? outsiderId : null;
        return id ? { user: { id } } : null;
      } } as SessionService;
      await app.register(serverRoutes, { prefix: '/api/v1/servers', database, cookieName: 'session', sessionService });
      const owner = { cookie: 'session=owner' };
      const member = { cookie: 'session=member' };
      const outsider = { cookie: 'session=outsider' };
      const base = `/api/v1/servers/${serverId}`;
      const other = `/api/v1/servers/${otherServerId}`;
      const send = async (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, headers = owner, payload?: unknown) =>
        app.inject({ method, url, headers: { ...headers, ...(payload === undefined ? {} : { 'content-type': 'application/json' }) }, ...(payload === undefined ? {} : { payload: JSON.stringify(payload) }) });

      assert.equal((await send('GET', `${base}/categories`, outsider)).statusCode, 404);
      assert.equal((await send('POST', `${base}/categories`, member, { name: 'No' })).statusCode, 403);
      for (const name of ['', ' ', 'x'.repeat(97)]) assert.equal((await send('POST', `${base}/categories`, owner, { name })).statusCode, 400);
      const a = (await send('POST', `${base}/categories`, owner, { name: '  Alpha  ' })).json().category;
      const b = (await send('POST', `${base}/categories`, owner, { name: 'Alpha' })).json().category;
      const foreign = (await send('POST', `${other}/categories`, owner, { name: 'Foreign' })).json().category;
      assert.equal(a.name, 'Alpha');
      assert.deepEqual((await send('GET', `${base}/categories`, member)).json().categories.map((item: { name: string }) => item.name), ['Alpha', 'Alpha']);
      assert.equal((await send('PATCH', `${base}/categories/${foreign.id}`, owner, { name: 'X' })).statusCode, 404);
      assert.equal((await send('DELETE', `${base}/categories/${foreign.id}`)).statusCode, 404);
      assert.equal((await send('POST', `${base}/categories/${foreign.id}/move`, owner, { targetIndex: 0 })).statusCode, 404);
      assert.equal((await send('POST', `${base}/categories/${a.id}/move`, owner, { targetIndex: 4 })).statusCode, 400);
      assert.equal((await send('POST', `${base}/categories/${a.id}/move`, member, { targetIndex: 0 })).statusCode, 403);
      assert.equal((await send('PATCH', `${base}/categories/${a.id}`, owner, { name: 'Renamed' })).json().category.name, 'Renamed');

      const create = async (name: string, categoryId?: string | null, route = base) => {
        const response = await send('POST', `${route}/channels`, owner, { name, categoryId });
        assert.equal(response.statusCode, 201, response.body);
        return response.json().channel;
      };
      const u = await create('uncategorized');
      const c1 = await create('first', a.id);
      const c2 = await create('second', a.id);
      const otherChannel = await create('foreign', foreign.id, other);
      assert.equal((await send('POST', `${base}/channels`, owner, { name: 'Bad', categoryId: foreign.id })).statusCode, 404);
      assert.equal((await pool.query(`select count(*)::int as n from conversations where kind='server_text' and created_by=$1`, [ownerId])).rows[0].n, 4);
      await pool.query('update server_text_channels set category_id=$1 where id=$2', [foreign.id, c1.id]);
      assert.equal((await send('GET', `${base}/channels`, member)).json().channels.some((item: { id: string }) => item.id === c1.id), false);
      await pool.query('update server_text_channels set category_id=$1 where id=$2', [a.id, c1.id]);
      await pool.query('update server_text_channels set category_id=$1 where id=$2', [a.id, otherChannel.id]);
      assert.equal((await send('DELETE', `${base}/categories/${a.id}`)).statusCode, 404);
      await pool.query('update server_text_channels set category_id=$1 where id=$2', [foreign.id, otherChannel.id]);
      await pool.query(`insert into messages(conversation_id,sender_id,client_message_id,body) values($1,$2,$3,'Preserve me')`, [c1.conversationId, ownerId, randomUUID()]);
      assert.equal((await send('POST', `${base}/channels/${otherChannel.id}/move`, owner, { targetCategoryId: a.id, targetIndex: 0 })).statusCode, 404);
      assert.equal((await send('POST', `${base}/channels/${c1.id}/move`, owner, { targetCategoryId: foreign.id, targetIndex: 0 })).statusCode, 404);
      assert.equal((await send('POST', `${base}/channels/${c1.id}/move`, owner, { targetCategoryId: null, targetIndex: 8 })).statusCode, 400);
      assert.equal((await send('POST', `${base}/channels/${c1.id}/move`, member, { targetCategoryId: null, targetIndex: 0 })).statusCode, 403);
      assert.equal((await send('POST', `${base}/channels/${c2.id}/move`, owner, { targetCategoryId: a.id, targetIndex: 0 })).statusCode, 200);
      assert.equal((await send('POST', `${base}/channels/${c1.id}/move`, owner, { targetCategoryId: b.id, targetIndex: 0 })).statusCode, 200);
      assert.equal((await send('POST', `${base}/channels/${u.id}/move`, owner, { targetCategoryId: b.id, targetIndex: 1 })).statusCode, 200);
      assert.equal((await send('POST', `${base}/channels/${u.id}/move`, owner, { targetCategoryId: null, targetIndex: 0 })).statusCode, 200);
      assert.equal((await send('POST', `${base}/categories/${b.id}/move`, owner, { targetIndex: 0 })).statusCode, 200);
      const concurrent = await Promise.all([
        send('POST', `${base}/categories/${a.id}/move`, owner, { targetIndex: 0 }),
        send('POST', `${base}/categories/${b.id}/move`, owner, { targetIndex: 0 })
      ]);
      assert.deepEqual(concurrent.map((response) => response.statusCode), [200, 200]);
      const concurrentChannels = await Promise.all([
        send('POST', `${base}/channels/${c1.id}/move`, owner, { targetCategoryId: b.id, targetIndex: 0 }),
        send('POST', `${base}/channels/${c2.id}/move`, owner, { targetCategoryId: b.id, targetIndex: 0 })
      ]);
      assert.deepEqual(concurrentChannels.map((response) => response.statusCode), [200, 200]);
      const createVsMove = await Promise.all([
        send('POST', `${base}/channels`, owner, { name: 'simultaneous', categoryId: b.id }),
        send('POST', `${base}/channels/${c1.id}/move`, owner, { targetCategoryId: b.id, targetIndex: 0 })
      ]);
      assert.deepEqual(createVsMove.map((response) => response.statusCode), [201, 200]);
      const deleteVsMove = await Promise.all([
        send('DELETE', `${base}/categories/${b.id}`),
        send('POST', `${base}/channels/${c2.id}/move`, owner, { targetCategoryId: b.id, targetIndex: 0 })
      ]);
      assert.equal(deleteVsMove[0]?.statusCode, 204);
      assert.ok([200, 404].includes(deleteVsMove[1]!.statusCode));
      const channels = (await send('GET', `${base}/channels`, member)).json().channels;
      assert.equal(channels.length, 4);
      assert.equal(channels.find((channel: { id: string }) => channel.id === c1.id).categoryId, null);
      assert.equal((await pool.query('select count(*)::int as n from messages where conversation_id=$1', [c1.conversationId])).rows[0].n, 1);
      assert.equal((await pool.query('select count(*)::int as n from conversations where id=$1', [c1.conversationId])).rows[0].n, 1);
      const positions = (await pool.query('select position from server_text_channels where server_id=$1 and category_id is null order by position', [serverId])).rows.map((row) => row.position);
      assert.deepEqual(positions, [0, 1, 2, 3]);
      assert.deepEqual((await pool.query('select position from server_channel_categories where server_id=$1 order by position', [serverId])).rows.map((row) => row.position), [0]);
    } finally {
      await app.close();
      await pool.query('delete from server_text_channels where server_id=$1 or server_id=$2', [serverId, otherServerId]);
      await pool.query(`delete from conversations where kind='server_text' and created_by=$1`, [ownerId]);
      await pool.query('delete from servers where id=$1 or id=$2', [serverId, otherServerId]);
      await pool.query('delete from users where id=any($1::uuid[])', [[ownerId, memberId, outsiderId]]);
      await pool.end();
    }
  });
