import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import cookie from '@fastify/cookie';
import Fastify from 'fastify';
import { Pool } from 'pg';
import type { Database } from '@cubic/database';
import type { SessionService } from '../security/session.js';
import { assignCustomRole, createCustomRole, deleteCustomRole } from '../servers/roles.js';
import { createOwnedServer } from '../servers/store.js';
import { serverRoutes } from './servers.js';

const connectionString = process.env.CUBIC_SERVER_TEST_DATABASE_URL;

test('role model enforces default, hierarchy, assignment boundaries, cascades, and scoped reads',
  { skip: !connectionString, timeout: 30_000 }, async () => {
    const pool = new Pool({ connectionString, max: 4 });
    const database = { pool } as Database;
    const [owner, member, outsider] = [randomUUID(), randomUUID(), randomUUID()];
    const ids = [owner, member, outsider];
    const servers: string[] = [];
    const app = Fastify({ logger: false });
    async function rejectsCode(query: string, values: unknown[], code: string) {
      await assert.rejects(pool.query(query, values), (error: any) => error.code === code);
    }
    try {
      for (const [i, id] of ids.entries()) {
        await pool.query(
          `insert into users (id, email, email_normalized, username, username_normalized, display_name, password_hash)
           values ($1, $2, $2, $3, $3, $4, 'test-only')`,
          [id, `${id}@integration.invalid`, `roles_${i}_${id.slice(0, 8)}`, `Role ${i}`]
        );
      }
      const first = await createOwnedServer(database, owner, 'Roles one');
      const second = await createOwnedServer(database, owner, 'Roles two');
      servers.push(first.id, second.id);
      await pool.query('insert into server_members (server_id, user_id) values ($1, $2), ($3, $4)', [first.id, member, second.id, outsider]);
      const defaultRole = (await pool.query('select * from server_roles where server_id = $1', [first.id])).rows;
      assert.equal(defaultRole.length, 1);
      assert.equal(defaultRole[0].id, first.id);
      assert.equal(defaultRole[0].position, 0);
      assert.equal(defaultRole[0].is_default, true);
      assert.equal((await pool.query('select count(*)::int as n from server_member_roles where server_id = $1', [first.id])).rows[0].n, 0);
      await rejectsCode('insert into server_roles (id, server_id, name, position, is_default) values ($1, $2, $3, 0, true)', [randomUUID(), first.id, '@everyone'], '23514');
      await rejectsCode('insert into server_roles (server_id, name, position, is_default) values ($1, $2, 0, true)', [first.id, '@everyone'], '23514');
      await rejectsCode('delete from server_roles where id = $1', [first.id], '23514');
      await rejectsCode('update server_roles set name = $1 where id = $2', ['Changed', first.id], '23514');
      assert.deepEqual(await deleteCustomRole(database, first.id, owner, first.id), { denied: 'invalid_role' });
      assert.deepEqual(await createCustomRole(database, first.id, outsider, 'No'), { denied: 'not_owner' });
      assert.deepEqual(await createCustomRole(database, first.id, owner, '  '), { denied: 'invalid_role' });
      const low = await createCustomRole(database, first.id, owner, 'Low');
      const high = await createCustomRole(database, first.id, owner, 'High');
      const foreign = await createCustomRole(database, second.id, owner, 'Foreign');
      assert.ok('value' in low && 'value' in high && 'value' in foreign);
      if (!('value' in low && 'value' in high && 'value' in foreign)) throw new Error('Role creation failed');
      assert.deepEqual([low.value.position, high.value.position], [1, 2]);
      const renamed = await pool.query('update server_roles set name = $1 where id = $2 returning name', ['Renamed', low.value.id]);
      assert.equal(renamed.rows[0].name, 'Renamed');
      const concurrent = await Promise.all([
        createCustomRole(database, first.id, owner, 'Concurrent A'),
        createCustomRole(database, first.id, owner, 'Concurrent B')
      ]);
      const concurrentRoles = concurrent.flatMap((result) => 'value' in result ? [result.value] : []);
      assert.equal(concurrentRoles.length, 2);
      assert.deepEqual(concurrentRoles.map((item) => item.position).sort(), [3, 4]);
      for (const item of concurrentRoles) assert.deepEqual(await deleteCustomRole(database, first.id, owner, item.id), { value: true });
      await rejectsCode('insert into server_roles (server_id, name, position) values ($1, $2, 1)', [first.id, 'Duplicate position'], '23505');
      await rejectsCode('insert into server_roles (server_id, name, position) values ($1, $2, -1)', [first.id, 'Negative'], '23514');
      await rejectsCode('insert into server_roles (server_id, name, position) values ($1, $2, 3)', [first.id, '  spaces  '], '23514');
      assert.deepEqual(await assignCustomRole(database, first.id, owner, member, foreign.value.id), { denied: 'invalid_role' });
      assert.deepEqual(await assignCustomRole(database, first.id, owner, outsider, low.value.id), { denied: 'invalid_member' });
      assert.deepEqual(await assignCustomRole(database, first.id, owner, member, first.id), { denied: 'invalid_role' });
      assert.deepEqual(await assignCustomRole(database, first.id, owner, member, low.value.id), { value: true });
      assert.deepEqual(await assignCustomRole(database, first.id, owner, member, low.value.id), { value: false });
      await rejectsCode('insert into server_member_roles (server_id, user_id, role_id) values ($1, $2, $3)', [first.id, member, low.value.id], '23505');
      await rejectsCode('insert into server_member_roles (server_id, user_id, role_id) values ($1, $2, $3)', [first.id, member, first.id], '23514');
      await rejectsCode('insert into server_member_roles (server_id, user_id, role_id) values ($1, $2, $3)', [first.id, member, foreign.value.id], '23503');
      await rejectsCode('insert into server_member_roles (server_id, user_id, role_id) values ($1, $2, $3)', [first.id, outsider, low.value.id], '23503');
      await app.register(cookie);
      app.decorateRequest('auth', null);
      await app.register(serverRoutes, { prefix: '/api/v1/servers', database, cookieName: 'session',
        sessionService: { resolveToken: async (token: string) => {
          const id = token === 'owner' ? owner : token === 'member' ? member : token === 'outsider' ? outsider : null;
          return id ? { user: { id } } : null;
        } } as SessionService });
      const url = `/api/v1/servers/${first.id}`;
      const ownerHeader = { cookie: 'session=owner' };
      const memberHeader = { cookie: 'session=member' };
      const outsiderHeader = { cookie: 'session=outsider' };
      assert.equal((await app.inject({ method: 'GET', url: `${url}/roles` })).statusCode, 401);
      assert.equal((await app.inject({ method: 'GET', url: `${url}/roles`, headers: outsiderHeader })).statusCode, 404);
      assert.equal((await app.inject({ method: 'GET', url: `/api/v1/servers/${randomUUID()}/roles`, headers: ownerHeader })).statusCode, 404);
      const roles = await app.inject({ method: 'GET', url: `${url}/roles`, headers: memberHeader });
      assert.equal(roles.statusCode, 200);
      assert.deepEqual(roles.json().roles.map((r: { position: number }) => r.position), [2, 1, 0]);
      assert.deepEqual(Object.keys(roles.json().roles[0]).sort(), ['id', 'isDefault', 'name', 'permissions', 'position', 'serverId']);
      assert.deepEqual(roles.json().roles[0].permissions, []);
      assert.deepEqual(roles.json().roles.at(-1).permissions,
        ['VIEW_SERVER', 'SEND_MESSAGES', 'CONNECT', 'SPEAK', 'VIDEO', 'SCREEN_SHARE']);
      const memberUrl = `${url}/members/${member}/roles`;
      assert.equal((await app.inject({ method: 'GET', url: memberUrl })).statusCode, 401);
      assert.equal((await app.inject({ method: 'GET', url: memberUrl, headers: outsiderHeader })).statusCode, 404);
      assert.equal((await app.inject({ method: 'GET', url: `${url}/members/${outsider}/roles`, headers: ownerHeader })).statusCode, 404);
      assert.equal((await app.inject({ method: 'GET', url: `/api/v1/servers/${second.id}/members/${member}/roles`, headers: ownerHeader })).statusCode, 404);
      assert.equal((await app.inject({ method: 'GET', url: `${url}/members/${randomUUID()}/roles`, headers: memberHeader })).statusCode, 404);
      assert.deepEqual((await app.inject({ method: 'GET', url: memberUrl, headers: ownerHeader })).json().roles.map((r: { position: number }) => r.position), [1, 0]);
      assert.deepEqual(await deleteCustomRole(database, first.id, owner, low.value.id), { value: true });
      assert.equal((await pool.query('select 1 from server_member_roles where role_id = $1', [low.value.id])).rowCount, 0);
      assert.deepEqual(await assignCustomRole(database, first.id, owner, member, high.value.id), { value: true });
      await pool.query('delete from server_members where server_id = $1 and user_id = $2', [first.id, member]);
      assert.equal((await pool.query('select 1 from server_member_roles where server_id = $1 and user_id = $2', [first.id, member])).rowCount, 0);
      await pool.query('delete from servers where id = $1', [first.id]);
      servers.shift();
      assert.equal((await pool.query('select 1 from server_roles where server_id = $1', [first.id])).rowCount, 0);
      assert.equal((await pool.query('select 1 from server_member_roles where server_id = $1', [first.id])).rowCount, 0);
    } finally {
      await app.close();
      await pool.query('delete from servers where id = any($1::uuid[])', [servers]).catch(() => {});
      await pool.query('delete from users where id = any($1::uuid[])', [ids]).catch(() => {});
      await pool.end();
    }
  });
