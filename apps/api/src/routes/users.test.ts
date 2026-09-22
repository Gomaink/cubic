import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, access, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import type { Database } from '@cubic/database';
import type { SessionService } from '../security/session.js';
import { LocalMediaStore } from '../media/local.js';
import { managedUserAvatarKey } from '../auth/identity.js';
import { createRealtimeEvents, type ProfileChangedEvent } from '../realtime/events.js';
import { userRoutes } from './users.js';

const ownerId = '123e4567-e89b-42d3-a456-426614174000';
const otherId = '123e4567-e89b-42d3-a456-426614174001';
const png = Buffer.from('89504e470d0a1a0a', 'hex');
const gif = Buffer.from('47494638396101000100800000000000ffffff21f90400000000002c000000000100010000020244010021f90400000000002c00000000010001000002024c01003b', 'hex');

class ProfileDatabase {
  readonly rows = new Map([[ownerId, { display_name: 'Owner', avatar_url: null as string | null }], [otherId, { display_name: 'Other', avatar_url: null as string | null }]]);
  failUpdate = false;
  readonly pool = {
    connect: async () => ({ query: this.query, release() {} }),
    query: (sql: string, params?: unknown[]) => this.query(sql, params)
  };
  readonly db = {
    update: () => ({
      set: (values: { displayName: string }) => ({
        where: () => ({
          returning: async () => {
            if (this.failUpdate) throw new Error('database unavailable');
            const row = this.rows.get(ownerId)!;
            row.display_name = values.displayName;
            return [{ displayName: row.display_name, avatarUrl: row.avatar_url }];
          }
        })
      })
    })
  };
  query = async (sql: string, params: unknown[] = []) => {
    const normalized = sql.replace(/\s+/gu, ' ').trim().toLowerCase();
    const row = this.rows.get(params[0] as string);
    if (normalized.startsWith('select avatar_url from users where id = $1 and avatar_url = $2')) {
      return { rows: row && row.avatar_url === params[1] ? [{ avatar_url: row.avatar_url }] : [] };
    }
    if (normalized.startsWith('select avatar_url from users where id = $1 for update')) {
      return { rows: row ? [{ avatar_url: row.avatar_url }] : [] };
    }
    if (normalized.startsWith('update users set avatar_url')) {
      if (this.failUpdate) throw new Error('database unavailable');
      if (row) row.avatar_url = params[1] as string | null;
      return { rows: row ? [{ display_name: row.display_name, avatar_url: row.avatar_url }] : [] };
    }
    return { rows: [] };
  };
}

function uploadPayload(bytes: Buffer, mime = 'image/png'): Buffer {
  return Buffer.concat([
    Buffer.from(`--avatar-test\r\nContent-Disposition: form-data; name="avatar"; filename="untrusted.svg"\r\nContent-Type: ${mime}\r\n\r\n`),
    bytes,
    Buffer.from('\r\n--avatar-test--\r\n')
  ]);
}

test('self profile and avatar changes preserve GIF bytes, immutable URL, old-file lifecycle and public event shape', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'cubic-user-route-test-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const store = new LocalMediaStore(root);
  const database = new ProfileDatabase();
  const events = createRealtimeEvents();
  const emitted: ProfileChangedEvent[] = [];
  events.onProfileChanged((event) => emitted.push(event));
  const app = Fastify({ logger: false });
  context.after(() => app.close());
  await app.register(cookie);
  await app.register(multipart);
  app.decorateRequest('auth', null);
  await app.register(userRoutes, {
    prefix: '/api/v1/users',
    database: database as unknown as Database,
    cookieName: 'session',
    sessionService: { resolveToken: async (token: string) => token === 'owner'
      ? { user: { id: ownerId, avatarUrl: database.rows.get(ownerId)!.avatar_url } }
      : token === 'other' ? { user: { id: otherId, avatarUrl: null } } : null } as unknown as SessionService,
    mediaStore: store,
    avatarMaxBytes: 2 * 1024 * 1024,
    realtimeEvents: events
  });
  const owner = { cookie: 'session=owner' };
  const other = { cookie: 'session=other' };
  const upload = (bytes: Buffer, mime?: string, headers = owner) => app.inject({
    method: 'POST', url: '/api/v1/users/me/avatar',
    headers: { ...headers, 'content-type': 'multipart/form-data; boundary=avatar-test' },
    payload: uploadPayload(bytes, mime)
  });

  const name = await app.inject({ method: 'PATCH', url: '/api/v1/users/me/profile', headers: owner, payload: { displayName: 'Updated Owner' } });
  assert.equal(name.statusCode, 200);
  assert.equal(database.rows.get(ownerId)!.display_name, 'Updated Owner');
  assert.deepEqual(emitted.at(-1), { userId: ownerId, displayName: 'Updated Owner', avatarUrl: null });
  assert.equal((await app.inject({ method: 'PATCH', url: `/api/v1/users/${otherId}/profile`, headers: owner, payload: { displayName: 'Not allowed' } })).statusCode, 404);
  assert.equal(database.rows.get(otherId)!.display_name, 'Other');
  const otherUpload = await upload(png, 'image/png', other);
  assert.equal(otherUpload.statusCode, 200);
  assert.equal(database.rows.get(ownerId)!.avatar_url, null);
  assert.notEqual(database.rows.get(otherId)!.avatar_url, null);
  const otherKey = managedUserAvatarKey(database.rows.get(otherId)!.avatar_url, otherId)!;

  const staticUpload = await upload(png, 'image/gif');
  assert.equal(staticUpload.statusCode, 200);
  const oldUrl = staticUpload.json().profile.avatarUrl as string;
  const oldKey = managedUserAvatarKey(oldUrl, ownerId)!;
  assert.ok(oldKey.endsWith('.png'));
  assert.equal((await store.readUserAvatar(oldKey)).contentType, 'image/png');

  database.failUpdate = true;
  assert.equal((await upload(gif)).statusCode, 500);
  assert.equal(database.rows.get(ownerId)!.avatar_url, oldUrl);
  assert.deepEqual((await store.readUserAvatar(oldKey)).buffer, png);
  assert.deepEqual((await readdir(store.userAvatarRoot)).sort(), [oldKey, otherKey].sort());
  database.failUpdate = false;

  const animated = await upload(gif, 'text/plain');
  assert.equal(animated.statusCode, 200);
  const newUrl = animated.json().profile.avatarUrl as string;
  const newKey = managedUserAvatarKey(newUrl, ownerId)!;
  assert.notEqual(newUrl, oldUrl);
  assert.ok(newKey.endsWith('.gif'));
  assert.deepEqual((await store.readUserAvatar(newKey)).buffer, gif);
  await assert.rejects(() => access(join(store.userAvatarRoot, oldKey)));
  assert.deepEqual(emitted.at(-1), { userId: ownerId, displayName: 'Updated Owner', avatarUrl: newUrl });
  assert.deepEqual(Object.keys(emitted.at(-1)!).sort(), ['avatarUrl', 'displayName', 'userId']);

  const served = await app.inject({ method: 'GET', url: newUrl, headers: other });
  assert.equal(served.statusCode, 200);
  assert.equal(served.headers['content-type'], 'image/gif');
  assert.deepEqual(served.rawPayload, gif);
  assert.equal((await app.inject({ method: 'GET', url: oldUrl, headers: owner })).statusCode, 404);
  assert.equal((await app.inject({ method: 'GET', url: newUrl })).statusCode, 401);

  assert.equal((await app.inject({ method: 'DELETE', url: '/api/v1/users/me/avatar', headers: owner })).statusCode, 200);
  assert.equal(database.rows.get(ownerId)!.avatar_url, null);
  await assert.rejects(() => access(join(store.userAvatarRoot, newKey)));
  assert.equal(emitted.at(-1)?.avatarUrl, null);
});

test('user-avatar upload rejects active content and oversized files before publication', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'cubic-user-route-invalid-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const app = Fastify({ logger: false });
  context.after(() => app.close());
  await app.register(cookie);
  await app.register(multipart);
  app.decorateRequest('auth', null);
  const database = new ProfileDatabase();
  await app.register(userRoutes, {
    prefix: '/api/v1/users',
    database: database as unknown as Database,
    cookieName: 'session',
    sessionService: { resolveToken: async () => ({ user: { id: ownerId, avatarUrl: null } }) } as unknown as SessionService,
    mediaStore: new LocalMediaStore(root),
    avatarMaxBytes: 2 * 1024 * 1024
  });
  const headers = { cookie: 'session=owner', 'content-type': 'multipart/form-data; boundary=avatar-test' };
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/users/me/avatar', headers, payload: uploadPayload(Buffer.from('<svg/>'), 'image/gif') })).statusCode, 415);
  assert.equal((await app.inject({ method: 'POST', url: '/api/v1/users/me/avatar', headers, payload: uploadPayload(Buffer.alloc(2 * 1024 * 1024 + 1)) })).statusCode, 413);
  assert.equal(database.rows.get(ownerId)!.avatar_url, null);
});
