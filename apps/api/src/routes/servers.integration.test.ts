import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { Pool } from 'pg';
import type { Database } from '@cubic/database';
import type { SessionService } from '../security/session.js';
import { serverRoutes } from './servers.js';

const connectionString = process.env.CUBIC_SERVER_TEST_DATABASE_URL
  ?? process.env.CUBIC_GROUP_TEST_DATABASE_URL;

test('server API creates atomic owner membership and scopes list/detail without converting legacy groups',
  { skip: !connectionString, timeout: 20_000 }, async () => {
    const pool = new Pool({ connectionString, max: 4 });
    const ownerId = randomUUID();
    const outsiderId = randomUUID();
    const groupId = randomUUID();
    const createdServerIds: string[] = [];
    const suffix = ownerId.replaceAll('-', '').slice(0, 20);
    const app = Fastify({ logger: false });
    try {
      for (const [index, id] of [ownerId, outsiderId].entries()) {
        await pool.query(
          `insert into users (id, email, email_normalized, username, username_normalized, display_name, password_hash)
           values ($1, $2, $2, $3, $3, $4, $5)`,
          [id, `${index}-${suffix}@integration.invalid`, `server_${index}_${suffix}`, `Server ${index}`, 'test-only']
        );
      }
      await pool.query('insert into conversations (id, kind, title) values ($1, $2, $3)', [groupId, 'group', 'Legacy group']);
      await pool.query('insert into conversation_members (conversation_id, user_id, role) values ($1, $2, $3)', [groupId, ownerId, 'owner']);

      await app.register(cookie);
      app.decorateRequest('auth', null);
      await app.register(serverRoutes, {
        prefix: '/api/v1/servers',
        database: { pool } as Database,
        cookieName: 'session',
        sessionService: {
          resolveToken: async (token: string) => token === 'owner'
            ? { user: { id: ownerId } }
            : token === 'outsider' ? { user: { id: outsiderId } } : null
        } as SessionService
      });
      const owner = { cookie: 'session=owner' };
      const outsider = { cookie: 'session=outsider' };

      assert.equal((await app.inject({ method: 'POST', url: '/api/v1/servers', payload: { name: 'A' } })).statusCode, 401);
      for (const name of ['', '   ', 'x'.repeat(97), 4, null]) {
        assert.equal((await app.inject({ method: 'POST', url: '/api/v1/servers', headers: owner, payload: { name } })).statusCode, 400);
      }
      const first = await app.inject({ method: 'POST', url: '/api/v1/servers', headers: owner, payload: { name: '  Aurora  ', ownerUserId: outsiderId } });
      assert.equal(first.statusCode, 201);
      const server = first.json().server;
      createdServerIds.push(server.id);
      assert.equal(server.name, 'Aurora');
      assert.equal(server.ownerUserId, ownerId);
      assert.deepEqual(Object.keys(server).sort(), ['createdAt', 'iconUrl', 'id', 'name', 'ownerUserId', 'updatedAt']);
      assert.equal(server.iconUrl, null);
      assert.equal(Number((await pool.query('select count(*)::int as n from server_members where server_id = $1 and user_id = $2', [server.id, ownerId])).rows[0].n), 1);

      const duplicateName = await app.inject({ method: 'POST', url: '/api/v1/servers', headers: owner, payload: { name: 'Aurora' } });
      assert.equal(duplicateName.statusCode, 201);
      createdServerIds.push(duplicateName.json().server.id);
      assert.notEqual(duplicateName.json().server.id, server.id);
      assert.equal((await app.inject({ method: 'POST', url: '/api/v1/servers', headers: owner, payload: { name: 'x'.repeat(96) } })).statusCode, 201);
      const maximumNameServer = (await pool.query('select id from servers where owner_user_id = $1 and name = $2', [ownerId, 'x'.repeat(96)])).rows[0].id;
      createdServerIds.push(maximumNameServer);

      const ownerList = await app.inject({ method: 'GET', url: '/api/v1/servers', headers: owner });
      assert.equal(ownerList.statusCode, 200);
      assert.equal(ownerList.json().servers.length, 3);
      assert.ok(ownerList.json().servers.every((item: { id: string }) => item.id !== groupId));
      assert.deepEqual((await app.inject({ method: 'GET', url: '/api/v1/servers', headers: outsider })).json(), { servers: [] });
      assert.equal((await app.inject({ method: 'GET', url: `/api/v1/servers/${server.id}`, headers: owner })).statusCode, 200);
      assert.equal((await app.inject({ method: 'GET', url: `/api/v1/servers/${server.id}`, headers: outsider })).statusCode, 404);
      assert.equal((await app.inject({ method: 'GET', url: `/api/v1/servers/${randomUUID()}`, headers: owner })).statusCode, 404);
      assert.equal((await app.inject({ method: 'GET', url: '/api/v1/servers/not-a-uuid', headers: owner })).statusCode, 400);
      assert.equal((await app.inject({ method: 'GET', url: `/api/v1/servers/${server.id}` })).statusCode, 401);
      assert.equal((await pool.query('select kind from conversations where id = $1', [groupId])).rows[0].kind, 'group');
    } finally {
      await app.close();
      await pool.query('delete from servers where id = any($1::uuid[])', [createdServerIds]);
      await pool.query('delete from conversations where id = $1', [groupId]);
      await pool.query('delete from users where id = any($1::uuid[])', [[ownerId, outsiderId]]);
      await pool.end();
    }
  });

test('PostgreSQL enforces membership uniqueness, FKs, deletion semantics, and transaction rollback',
  { skip: !connectionString, timeout: 20_000 }, async () => {
    const pool = new Pool({ connectionString, max: 1 });
    const client = await pool.connect();
    const ownerId = randomUUID();
    const memberId = randomUUID();
    const serverId = randomUUID();
    const rollbackId = randomUUID();
    async function expectCode(query: string, values: unknown[], code: string) {
      await client.query('savepoint expected_failure');
      try {
        await assert.rejects(client.query(query, values), (error: any) => error.code === code);
      } finally {
        await client.query('rollback to savepoint expected_failure');
        await client.query('release savepoint expected_failure');
      }
    }
    try {
      await client.query('begin');
      for (const [index, id] of [ownerId, memberId].entries()) {
        await client.query(
          `insert into users (id, email, email_normalized, username, username_normalized, display_name, password_hash)
           values ($1, $2, $2, $3, $3, $4, $5)`,
          [id, `${id}@integration.invalid`, `server_fk_${index}_${id.slice(0, 8)}`, `Fixture ${index}`, 'test-only']
        );
      }
      await client.query('insert into servers (id, name, owner_user_id) values ($1, $2, $3)', [serverId, 'One', ownerId]);
      await client.query('insert into server_members (server_id, user_id) values ($1, $2), ($1, $3)', [serverId, ownerId, memberId]);
      await expectCode('insert into server_members (server_id, user_id) values ($1, $2)', [serverId, ownerId], '23505');
      await expectCode('insert into server_members (server_id, user_id) values ($1, $2)', [randomUUID(), ownerId], '23503');
      await expectCode('insert into server_members (server_id, user_id) values ($1, $2)', [serverId, randomUUID()], '23503');
      await expectCode('delete from users where id = $1', [ownerId], '23001');

      await client.query('savepoint creation_attempt');
      await client.query('insert into servers (id, name, owner_user_id) values ($1, $2, $3)', [rollbackId, 'Rollback', ownerId]);
      await expectCode('insert into server_members (server_id, user_id) values ($1, $2)', [rollbackId, randomUUID()], '23503');
      await client.query('rollback to savepoint creation_attempt');
      assert.equal((await client.query('select 1 from servers where id = $1', [rollbackId])).rowCount, 0);

      await client.query('delete from users where id = $1', [memberId]);
      assert.equal((await client.query('select 1 from server_members where server_id = $1 and user_id = $2', [serverId, memberId])).rowCount, 0);
      await client.query('delete from servers where id = $1', [serverId]);
      assert.equal((await client.query('select 1 from server_members where server_id = $1', [serverId])).rowCount, 0);
      await client.query('rollback');
    } finally {
      await client.query('rollback').catch(() => {});
      client.release();
      await pool.end();
    }
  });
