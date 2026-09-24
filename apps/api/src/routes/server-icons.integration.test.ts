import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { access, mkdtemp, readdir, rm, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import sharp from 'sharp';
import { Pool } from 'pg';
import type { Database } from '@cubic/database';
import type { SessionService } from '../security/session.js';
import { ServerIconStore } from '../server-icons/storage.js';
import { replaceServerIcon, removeServerIcon } from '../server-icons/service.js';
import { ServerIconReconciler } from '../server-icons/reconciliation.js';
import { serverRoutes } from './servers.js';

const connectionString = process.env.CUBIC_SERVER_TEST_DATABASE_URL ?? process.env.CUBIC_GROUP_TEST_DATABASE_URL;
const logger = { warn() {} };

function uploadPayload(bytes: Buffer, mime = 'image/png'): Buffer {
  return Buffer.concat([
    Buffer.from(`--icon-test\r\nContent-Disposition: form-data; name="icon"; filename="not-trusted.svg"\r\nContent-Type: ${mime}\r\n\r\n`),
    bytes,
    Buffer.from('\r\n--icon-test--\r\n')
  ]);
}

test('server icon API enforces owner mutation, member delivery, canonical media and replacement lifecycle',
  { skip: !connectionString, timeout: 30_000 }, async (context) => {
    const pool = new Pool({ connectionString, max: 6 });
    const root = await mkdtemp(join(tmpdir(), 'cubic-server-icons-api-'));
    const store = new ServerIconStore(root);
    await store.prepare();
    const [owner, member, outsider] = [randomUUID(), randomUUID(), randomUUID()];
    const serverId = randomUUID();
    const otherServerId = randomUUID();
    const app = Fastify({ logger: false });
    context.after(async () => {
      await app.close();
      await pool.query('delete from servers where id = any($1::uuid[])', [[serverId, otherServerId]]);
      await pool.query('delete from users where id = any($1::uuid[])', [[owner, member, outsider]]);
      await pool.end();
      await rm(root, { recursive: true, force: true });
    });
    for (const [index, id] of [owner, member, outsider].entries()) {
      await pool.query(`insert into users (id,email,email_normalized,username,username_normalized,display_name,password_hash)
        values ($1,$2,$2,$3,$3,$4,'test')`, [id, `${id}@test.invalid`, `icon_${index}_${id.slice(0, 8)}`, `Icon ${index}`]);
    }
    await pool.query('insert into servers (id,name,owner_user_id) values ($1,$2,$3),($4,$5,$6)',
      [serverId, 'Icons', owner, otherServerId, 'Other', outsider]);
    await pool.query('insert into server_members (server_id,user_id) values ($1,$2),($1,$3),($4,$5)',
      [serverId, owner, member, otherServerId, outsider]);
    await app.register(cookie);
    await app.register(multipart, { limits: { files: 1, fileSize: 5 * 1024 * 1024 + 1 } });
    app.decorateRequest('auth', null);
    await app.register(serverRoutes, { prefix: '/api/v1/servers', database: { pool } as Database,
      cookieName: 'session', iconStore: store, sessionService: {
        resolveToken: async (token: string) => ({ owner, member, outsider }[token]
          ? { user: { id: { owner, member, outsider }[token] } } : null)
      } as SessionService });
    const url = `/api/v1/servers/${serverId}/icon`;
    const png = await sharp({ create: { width: 64, height: 32, channels: 3, background: 'red' } }).png().toBuffer();
    const blue = await sharp({ create: { width: 64, height: 32, channels: 3, background: 'blue' } }).jpeg().toBuffer();
    const upload = (token: string, bytes: Buffer, mime?: string) => app.inject({ method: 'PUT', url,
      headers: { cookie: `session=${token}`, 'content-type': 'multipart/form-data; boundary=icon-test' },
      payload: uploadPayload(bytes, mime) });
    assert.equal((await upload('member', png)).statusCode, 403);
    assert.equal((await upload('outsider', png)).statusCode, 404);
    assert.equal((await app.inject({ method: 'PUT', url: `/api/v1/servers/${otherServerId}/icon`,
      headers: { cookie: 'session=owner', 'content-type': 'multipart/form-data; boundary=icon-test' },
      payload: uploadPayload(png) })).statusCode, 404);
    assert.equal((await app.inject({ method: 'GET', url, headers: { cookie: 'session=outsider' } })).statusCode, 404);
    const first = await upload('owner', png, 'application/octet-stream');
    assert.equal(first.statusCode, 200, first.body);
    assert.match(first.json().server.iconUrl, /\/api\/v1\/servers\/[^/]+\/icon\?v=/);
    assert.equal('iconKey' in first.json().server, false);
    const firstKey = (await pool.query('select icon_key from servers where id=$1', [serverId])).rows[0].icon_key as string;
    const delivered = await app.inject({ method: 'GET', url, headers: { cookie: 'session=member' } });
    assert.equal(delivered.statusCode, 200);
    assert.equal(delivered.headers['content-type'], 'image/webp');
    assert.equal(delivered.headers['cache-control'], 'private, no-store');
    const metadata = await sharp(delivered.rawPayload).metadata();
    assert.deepEqual([metadata.format, metadata.width, metadata.height], ['webp', 512, 512]);
    assert.equal((await upload('owner', Buffer.from('<svg/>'), 'image/png')).statusCode, 415);
    assert.equal((await pool.query('select icon_key from servers where id=$1', [serverId])).rows[0].icon_key, firstKey);
    const second = await upload('owner', blue, 'image/gif');
    assert.equal(second.statusCode, 200, second.body);
    const secondKey = (await pool.query('select icon_key from servers where id=$1', [serverId])).rows[0].icon_key as string;
    assert.notEqual(firstKey, secondKey);
    await assert.rejects(access(join(store.root, firstKey)));
    assert.equal((await app.inject({ method: 'DELETE', url, headers: { cookie: 'session=member' } })).statusCode, 403);
    assert.equal((await app.inject({ method: 'DELETE', url, headers: { cookie: 'session=owner' } })).statusCode, 200);
    assert.equal((await pool.query('select icon_key from servers where id=$1', [serverId])).rows[0].icon_key, null);
    await assert.rejects(access(join(store.root, secondKey)));
    assert.equal((await app.inject({ method: 'GET', url, headers: { cookie: 'session=member' } })).statusCode, 404);
  });

test('concurrent icon mutations serialize on server row and leave the committed key readable',
  { skip: !connectionString, timeout: 30_000 }, async () => {
    const pool = new Pool({ connectionString, max: 6 });
    const root = await mkdtemp(join(tmpdir(), 'cubic-server-icons-race-'));
    const store = new ServerIconStore(root);
    const owner = randomUUID(), serverId = randomUUID();
    try {
      await store.prepare();
      await pool.query(`insert into users (id,email,email_normalized,username,username_normalized,display_name,password_hash)
        values ($1,$2,$2,$3,$3,'Owner','test')`, [owner, `${owner}@test.invalid`, `iconrace_${owner.slice(0, 8)}`]);
      await pool.query('insert into servers (id,name,owner_user_id) values ($1,$2,$3)', [serverId, 'Race', owner]);
      await pool.query('insert into server_members (server_id,user_id) values ($1,$2)', [serverId, owner]);
      const database = { pool } as Database;
      const bytes = await sharp({ create: { width: 10, height: 10, channels: 3, background: 'green' } }).png().toBuffer();
      await Promise.all([
        replaceServerIcon({ database, store, serverId, actorId: owner, input: bytes, logger }),
        replaceServerIcon({ database, store, serverId, actorId: owner, input: bytes, logger })
      ]);
      const key = (await pool.query('select icon_key from servers where id=$1', [serverId])).rows[0].icon_key as string;
      await store.read(key);
      await Promise.all([
        removeServerIcon({ database, store, serverId, actorId: owner, logger }),
        replaceServerIcon({ database, store, serverId, actorId: owner, input: bytes, logger })
      ]);
      const finalKey = (await pool.query('select icon_key from servers where id=$1', [serverId])).rows[0].icon_key as string | null;
      if (finalKey) await store.read(finalKey);
    } finally {
      await pool.query('delete from servers where id=$1', [serverId]);
      await pool.query('delete from users where id=$1', [owner]);
      await pool.end();
      await rm(root, { recursive: true, force: true });
    }
  });

test('failed old unlink is reconciled and failed DB swap does not replace the referenced icon',
  { skip: !connectionString, timeout: 30_000 }, async () => {
    const pool = new Pool({ connectionString, max: 4 });
    const root = await mkdtemp(join(tmpdir(), 'cubic-server-icon-failures-'));
    const store = new ServerIconStore(root);
    const owner = randomUUID(), serverId = randomUUID();
    try {
      await store.prepare();
      await pool.query(`insert into users (id,email,email_normalized,username,username_normalized,display_name,password_hash)
        values ($1,$2,$2,$3,$3,'Owner','test')`, [owner, `${owner}@test.invalid`, `iconfail_${owner.slice(0, 8)}`]);
      await pool.query('insert into servers (id,name,owner_user_id) values ($1,$2,$3)', [serverId, 'Failures', owner]);
      await pool.query('insert into server_members (server_id,user_id) values ($1,$2)', [serverId, owner]);
      const database = { pool } as Database;
      const input = await sharp({ create: { width: 10, height: 10, channels: 3, background: 'red' } }).png().toBuffer();
      await replaceServerIcon({ database, store, serverId, actorId: owner, input, logger });
      const firstKey = (await pool.query('select icon_key from servers where id=$1', [serverId])).rows[0].icon_key as string;
      const originalDelete = store.deleteCanonical.bind(store);
      let failOnce = true;
      store.deleteCanonical = async (key) => {
        if (key === firstKey && failOnce) { failOnce = false; throw new Error('simulated unlink failure'); }
        await originalDelete(key);
      };
      await replaceServerIcon({ database, store, serverId, actorId: owner, input, logger });
      const secondKey = (await pool.query('select icon_key from servers where id=$1', [serverId])).rows[0].icon_key as string;
      await access(join(store.root, firstKey));
      await store.read(secondKey);
      const age = new Date(Date.now() - 2 * 60 * 60 * 1000);
      await utimes(join(store.root, firstKey), age, age);
      const reconciler = new ServerIconReconciler({ database, store, logger: { info() {}, warn() {} } });
      await reconciler.runBatch();
      await reconciler.stop();
      await assert.rejects(access(join(store.root, firstKey)));
      await store.read(secondKey);

      const failingDatabase = { pool: {
        query: pool.query.bind(pool),
        connect: async () => {
          const client = await pool.connect();
          return {
            query: async (sql: string, params?: unknown[]) => {
              if (sql.startsWith('update servers set icon_key')) throw new Error('simulated DB update failure');
              return client.query(sql, params);
            },
            release: () => client.release()
          };
        }
      } } as unknown as Database;
      await assert.rejects(replaceServerIcon({ database: failingDatabase, store, serverId, actorId: owner, input, logger }));
      assert.equal((await pool.query('select icon_key from servers where id=$1', [serverId])).rows[0].icon_key, secondKey);
      assert.deepEqual((await readdir(store.root)).filter((name) => name.endsWith('.webp')), [secondKey]);

      const originalWrite = store.writeTemp.bind(store);
      store.writeTemp = async () => { throw new Error('simulated file-write failure'); };
      await assert.rejects(replaceServerIcon({ database, store, serverId, actorId: owner, input, logger }));
      store.writeTemp = originalWrite;
      assert.equal((await pool.query('select icon_key from servers where id=$1', [serverId])).rows[0].icon_key, secondKey);

      const noConnection = { pool: {
        query: pool.query.bind(pool),
        connect: async () => { throw new Error('simulated DB connection failure'); }
      } } as unknown as Database;
      await assert.rejects(replaceServerIcon({ database: noConnection, store, serverId, actorId: owner, input, logger }));
      assert.deepEqual(await readdir(store.tempRoot), []);
      assert.equal((await pool.query('select icon_key from servers where id=$1', [serverId])).rows[0].icon_key, secondKey);

      store.deleteCanonical = async (key) => {
        if (key === secondKey) throw new Error('simulated unlink failure');
        await originalDelete(key);
      };
      await removeServerIcon({ database, store, serverId, actorId: owner, logger });
      assert.equal((await pool.query('select icon_key from servers where id=$1', [serverId])).rows[0].icon_key, null);
      await access(join(store.root, secondKey));
      store.deleteCanonical = originalDelete;
      await utimes(join(store.root, secondKey), age, age);
      await reconciler.runBatch();
      await reconciler.stop();
      await assert.rejects(access(join(store.root, secondKey)));
    } finally {
      await pool.query('delete from servers where id=$1', [serverId]);
      await pool.query('delete from users where id=$1', [owner]);
      await pool.end();
      await rm(root, { recursive: true, force: true });
    }
  });
