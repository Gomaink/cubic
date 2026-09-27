import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { createDatabase, type Database } from '@cubic/database';
import { createRealtimeEvents } from '../realtime/events.js';
import { createBrowserMutationProtection } from '../security/browser-request.js';
import { hashPassword } from '../security/password.js';
import { createSessionService } from '../security/session.js';
import type { SessionService } from '../security/session.js';
import { authRoutes } from './auth.js';

const connectionString = process.env.CUBIC_SECURITY_TEST_DATABASE_URL;
const currentPassword = 'test-only-current-password';
const nextPassword = 'test-only-next-password';
const origin = 'http://127.0.0.1:3197';

test('password change verifies credentials, atomically revokes other sessions, and preserves the current session',
  { skip: !connectionString, timeout: 30_000 }, async () => {
    const database = createDatabase(connectionString!);
    let failRevoke = false;
    const routeDatabase = {
      db: database.db,
      pool: {
        connect: async () => {
          const client = await database.pool.connect();
          if (!failRevoke) return client;
          return new Proxy(client, {
            get(target, property) {
              if (property === 'query') return (sql: string, values?: unknown[]) => {
                if (sql.startsWith('delete from sessions where user_id')) throw new Error('Fixture transaction failure');
                return target.query(sql, values);
              };
              if (property === 'release') return target.release.bind(target);
              return Reflect.get(target, property);
            }
          });
        }
      }
    } as unknown as Database;
    const sessions = createSessionService(database, 30 * 24 * 60 * 60 * 1000);
    const events = createRealtimeEvents();
    const revoked: string[] = [];
    events.onSessionRevoked((event) => revoked.push(event.sessionId));
    const app = Fastify({ logger: false });
    const suffix = randomUUID().replaceAll('-', '').slice(0, 16);
    const email = `security-${suffix}@integration.invalid`;
    const username = `security_${suffix}`;
    let userId = '';
    try {
      await app.register(cookie);
      app.decorateRequest('auth', null);
      app.addHook('onRequest', createBrowserMutationProtection(origin));
      await app.register(authRoutes, { prefix: '/api/v1/auth', database: routeDatabase, cookieName: 'session', cookieSecure: false,
        sessionTtlDays: 30, registrationEnabled: true, sessionService: sessions, realtimeEvents: events });
      const headers = { origin, 'sec-fetch-site': 'same-origin' };
      const cookieOf = (response: { headers: Record<string, unknown> }) =>
        String(response.headers['set-cookie']).split(';', 1)[0] ?? '';
      const change = (cookieValue: string | null, payload: Record<string, string>) => app.inject({ method: 'PATCH', url: '/api/v1/auth/password',
        headers: cookieValue ? { ...headers, cookie: cookieValue } : headers, payload });

      assert.equal((await change(null, { currentPassword, newPassword: nextPassword, confirmPassword: nextPassword })).statusCode, 401);
      const registered = await app.inject({ method: 'POST', url: '/api/v1/auth/register', headers,
        payload: { email, username, displayName: 'Security fixture', password: currentPassword } });
      assert.equal(registered.statusCode, 201, registered.body);
      userId = registered.json().user.id;
      const currentCookie = cookieOf(registered);
      assert.match(String(registered.headers['set-cookie']), /HttpOnly/i);
      assert.match(String(registered.headers['set-cookie']), /SameSite=Lax/i);
      const crossOrigin = await app.inject({ method: 'PATCH', url: '/api/v1/auth/password',
        headers: { origin: 'https://other.invalid', 'sec-fetch-site': 'cross-site', cookie: currentCookie },
        payload: { currentPassword, newPassword: nextPassword, confirmPassword: nextPassword } });
      assert.equal(crossOrigin.statusCode, 403);
      const firstHash = (await database.pool.query<{ password_hash: string }>('select password_hash from users where id = $1', [userId])).rows[0]!.password_hash;
      assert.match(firstHash, /^\$argon2id\$/);
      assert.notEqual(firstHash, currentPassword);

      const login = (password: string) => app.inject({ method: 'POST', url: '/api/v1/auth/login', headers,
        payload: { identifier: username, password } });
      const other = await login(currentPassword);
      assert.equal(other.statusCode, 200, other.body);
      const otherCookie = cookieOf(other);
      const before = await app.inject({ method: 'GET', url: '/api/v1/auth/sessions', headers: { cookie: currentCookie } });
      assert.equal(before.json().sessions.length, 2);
      const otherId = before.json().sessions.find((session: { current: boolean }) => !session.current).id;

      assert.equal((await change(currentCookie, { currentPassword: 'wrong-current', newPassword: nextPassword, confirmPassword: nextPassword })).statusCode, 403);
      assert.equal((await change(currentCookie, { currentPassword, newPassword: 'short', confirmPassword: 'short' })).statusCode, 400);
      assert.equal((await change(currentCookie, { currentPassword, newPassword: nextPassword, confirmPassword: 'different' })).statusCode, 400);
      assert.equal((await database.pool.query<{ password_hash: string }>('select password_hash from users where id = $1', [userId])).rows[0]!.password_hash, firstHash);
      assert.equal((await app.inject({ method: 'GET', url: '/api/v1/auth/sessions', headers: { cookie: otherCookie } })).statusCode, 200);

      failRevoke = true;
      try {
        const failed = await change(currentCookie, { currentPassword, newPassword: nextPassword, confirmPassword: nextPassword });
        assert.equal(failed.statusCode, 500);
        assert.ok(!failed.body.includes(currentPassword) && !failed.body.includes(nextPassword));
      } finally {
        failRevoke = false;
      }
      assert.equal((await database.pool.query<{ password_hash: string }>('select password_hash from users where id = $1', [userId])).rows[0]!.password_hash, firstHash);
      assert.equal((await app.inject({ method: 'GET', url: '/api/v1/auth/sessions', headers: { cookie: otherCookie } })).statusCode, 200);

      const changed = await change(currentCookie, { currentPassword, newPassword: nextPassword, confirmPassword: nextPassword });
      assert.equal(changed.statusCode, 200, changed.body);
      assert.deepEqual(changed.json(), { message: 'Password changed. Other sessions were signed out.' });
      assert.ok(!changed.body.includes(currentPassword) && !changed.body.includes(nextPassword));
      const nextHash = (await database.pool.query<{ password_hash: string }>('select password_hash from users where id = $1', [userId])).rows[0]!.password_hash;
      assert.match(nextHash, /^\$argon2id\$/);
      assert.notEqual(nextHash, firstHash);
      assert.equal((await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { cookie: currentCookie } })).statusCode, 200);
      assert.equal((await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { cookie: otherCookie } })).statusCode, 401);
      const after = await app.inject({ method: 'GET', url: '/api/v1/auth/sessions', headers: { cookie: currentCookie } });
      assert.equal(after.json().sessions.length, 1);
      assert.equal(after.json().sessions[0].current, true);
      assert.deepEqual(revoked, [otherId]);
      assert.equal((await login(currentPassword)).statusCode, 401);
      assert.equal((await login(nextPassword)).statusCode, 200);
    } finally {
      await app.close();
      if (userId) await database.pool.query('delete from users where id = $1', [userId]);
      await database.pool.end();
    }
  });

test('a concurrent old-password login is revoked when password change commits',
  { skip: !connectionString, timeout: 20_000 }, async () => {
    const database = createDatabase(connectionString!);
    const sessions = createSessionService(database, 30 * 24 * 60 * 60 * 1000);
    const userId = randomUUID();
    const suffix = userId.replaceAll('-', '').slice(0, 16);
    const username = `race_${suffix}`;
    const app = Fastify({ logger: false });
    let releaseLogin = () => {};
    let loginPaused = false;
    let startedChange!: () => void;
    const changeStarted = new Promise<void>((resolve) => { startedChange = resolve; });
    try {
      await database.pool.query(
        `insert into users (id, email, email_normalized, username, username_normalized, display_name, password_hash)
         values ($1, $2, $2, $3, $3, $4, $5)`,
        [userId, `${suffix}@integration.invalid`, username, 'Race fixture', await hashPassword(currentPassword)]
      );
      const current = await sessions.create(userId, 30);
      const currentCookie = `session=${current.token}`;
      const created = sessions.create.bind(sessions);
      const entered = new Promise<void>((resolve) => {
        (sessions as any).create = async (...args: Parameters<SessionService['create']>) => {
          loginPaused = true;
          resolve();
          await new Promise<void>((release) => { releaseLogin = release; });
          return created(...args);
        };
      });
      const routeDatabase = {
        db: database.db,
        pool: {
          connect: async () => new Proxy(await database.pool.connect(), {
            get(client, property) {
              if (property === 'query') return (sql: string, values?: unknown[]) => {
                if (loginPaused && sql.startsWith('select password_hash')) startedChange();
                return client.query(sql, values);
              };
              if (property === 'release') return client.release.bind(client);
              return Reflect.get(client, property);
            }
          })
        }
      } as unknown as Database;
      await app.register(cookie);
      app.decorateRequest('auth', null);
      await app.register(authRoutes, { prefix: '/api/v1/auth', database: routeDatabase, cookieName: 'session',
        cookieSecure: false, sessionTtlDays: 30, registrationEnabled: false, sessionService: sessions,
        realtimeEvents: createRealtimeEvents() });

      const loggingIn = app.inject({ method: 'POST', url: '/api/v1/auth/login',
        payload: { identifier: username, password: currentPassword } });
      await entered;
      const changing = app.inject({ method: 'PATCH', url: '/api/v1/auth/password', headers: { cookie: currentCookie },
        payload: { currentPassword, newPassword: nextPassword, confirmPassword: nextPassword } });
      await changeStarted;
      releaseLogin();
      const login = await loggingIn;
      const change = await changing;
      assert.equal(login.statusCode, 200, login.body);
      assert.equal(change.statusCode, 200, change.body);
      const racingCookie = String(login.headers['set-cookie']).split(';', 1)[0] ?? '';
      assert.equal((await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { cookie: racingCookie } })).statusCode, 401);
      assert.equal((await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { cookie: currentCookie } })).statusCode, 200);
    } finally {
      releaseLogin();
      await app.close();
      await database.pool.query('delete from users where id = $1', [userId]);
      await database.pool.end();
    }
  });

test('password change has a dedicated attempt limit', async () => {
  const app = Fastify({ logger: false });
  try {
    await app.register(cookie);
    await app.register(rateLimit, { global: false });
    app.decorateRequest('auth', null);
    await app.register(authRoutes, {
      prefix: '/api/v1/auth', database: {} as Database, cookieName: 'session', cookieSecure: false,
      sessionTtlDays: 30, registrationEnabled: false,
      sessionService: { resolveToken: async () => ({ sessionId: randomUUID(), user: { id: randomUUID() } }) } as unknown as SessionService,
      realtimeEvents: createRealtimeEvents()
    });
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const response = await app.inject({ method: 'PATCH', url: '/api/v1/auth/password',
        headers: { cookie: 'session=fixture' },
        payload: { currentPassword: 'fixture', newPassword: 'short', confirmPassword: 'short' } });
      assert.equal(response.statusCode, attempt < 5 ? 400 : 429);
    }
  } finally {
    await app.close();
  }
});
