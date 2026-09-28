import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { createDatabase } from '@cubic/database';
import { createRealtimeEvents } from '../realtime/events.js';
import { createBrowserMutationProtection } from '../security/browser-request.js';
import { createSessionService } from '../security/session.js';
import { EmailVerificationService } from '../mail/email-verification.js';
import { PasswordRecoveryService, PASSWORD_RESET_TTL_MS } from '../mail/password-recovery.js';
import { disabledMailTransport, type MailMessage, type MailTransport } from '../mail/transport.js';
import { authRoutes } from './auth.js';
import { accountEmailRoutes } from './account-email.js';
import { passwordRecoveryRoutes } from './password-recovery.js';

const connectionString = process.env.CUBIC_RECOVERY_TEST_DATABASE_URL;
const origin = 'http://127.0.0.1:3197';
const oldPassword = 'test-only-old-password';
const newPassword = 'test-only-new-password';

test('verified-only recovery is generic, digest-only, single-use and revokes all sessions',
  { skip: !connectionString, timeout: 60_000 }, async () => {
    const database = createDatabase(connectionString!);
    const sessions = createSessionService(database, 30 * 24 * 60 * 60 * 1000);
    const events = createRealtimeEvents();
    const revokedIds: string[] = [];
    events.onSessionRevoked((event) => revokedIds.push(event.sessionId));
    const messages: MailMessage[] = [];
    let failMail = false;
    const mail: MailTransport = { available: true, publicAppUrl: origin,
      async send(message) { if (failMail) throw new Error('Fixture mail failure'); messages.push(message); } };
    const email = new EmailVerificationService(database, mail, events);
    const recovery = new PasswordRecoveryService(database, mail, events);
    const app = Fastify({ logger: false });
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
    const username = `recover_${suffix}`;
    const address = `${username}@example.test`;
    const userIds: string[] = [];
    const headers = { origin, 'sec-fetch-site': 'same-origin' };
    const cookieOf = (response: { headers: Record<string, unknown> }) => String(response.headers['set-cookie']).split(';', 1)[0] ?? '';
    const tokenOf = () => new URL(messages.at(-1)!.text.match(/https?:\/\/[^\s]+/)![0]).hash.slice('#token='.length);
    const post = (path: string, payload: object, cookieValue?: string) => app.inject({ method: 'POST', url: `/api/v1/auth${path}`,
      headers: cookieValue ? { ...headers, cookie: cookieValue } : headers, payload });
    const register = async (name: string, emailAddress: string) => {
      const response = await post('/register', { email: emailAddress, username: name, displayName: 'Recovery fixture', password: oldPassword });
      assert.equal(response.statusCode, 201);
      userIds.push(response.json().user.id);
      return response;
    };
    try {
      await app.register(cookie);
      await app.register(rateLimit, { global: true, max: 300, timeWindow: '1 minute' });
      app.decorateRequest('auth', null);
      app.addHook('onRequest', createBrowserMutationProtection(origin));
      await app.register(authRoutes, { prefix: '/api/v1/auth', database, cookieName: 'session', cookieSecure: false,
        sessionTtlDays: 30, registrationEnabled: true, sessionService: sessions, realtimeEvents: events, emailVerification: email });
      await app.register(accountEmailRoutes, { prefix: '/api/v1/auth', cookieName: 'session', sessionService: sessions, emailVerification: email });
      await app.register(passwordRecoveryRoutes, { prefix: '/api/v1/auth', recovery });
      assert.deepEqual((await app.inject({ method: 'GET', url: '/api/v1/auth/capabilities' })).json(), { passwordRecoveryAvailable: true });

      const first = await register(username, address);
      const userId = first.json().user.id;
      const firstCookie = cookieOf(first);
      const verifyToken = tokenOf();
      assert.equal((await post('/email/verify', { token: verifyToken })).json().status, 'verified');
      const unverified = await register(`unverified_${suffix}`, `unverified_${suffix}@example.test`);
      const disabled = await register(`disabled_${suffix}`, `disabled_${suffix}@example.test`);
      await database.pool.query('update users set email_verified_at = now(), disabled_at = now() where id = $1', [disabled.json().user.id]);

      const request = (identifier: string) => post('/password/recovery', { identifier });
      const generic = { message: 'If an eligible account exists, password reset instructions have been sent.' };
      const eligible = await request(address);
      assert.equal(eligible.statusCode, 200);
      assert.deepEqual(eligible.json(), generic);
      const firstReset = tokenOf();
      const initialDigest = createHash('sha256').update(firstReset).digest('hex');
      const initialRow = (await database.pool.query<{ token_digest: string; expires_at: Date; created_at: Date }>(
        'select token_digest, expires_at, created_at from password_reset_tokens where user_id = $1', [userId])).rows[0]!;
      assert.equal(initialRow.token_digest, initialDigest);
      assert.ok(Math.abs(initialRow.expires_at.getTime() - initialRow.created_at.getTime() - PASSWORD_RESET_TTL_MS) < 5_000);
      assert.equal(JSON.stringify(eligible.json()).includes(firstReset), false);
      assert.equal((await request(username)).statusCode, 200);
      const secondReset = tokenOf();
      assert.equal((await post('/password/reset', { token: firstReset, newPassword })).json().status, 'invalid');
      const mailCount = messages.length;
      for (const identifier of [`missing_${suffix}`, `unverified_${suffix}`, `disabled_${suffix}`]) {
        const response = await request(identifier);
        assert.equal(response.statusCode, 200);
        assert.deepEqual(response.json(), generic);
      }
      assert.equal(messages.length, mailCount);
      assert.equal((await request(address)).statusCode, 429);
      assert.equal((await post('/password/reset', { token: 'x'.repeat(43), newPassword })).json().status, 'invalid');
      assert.equal((await post('/password/reset', { token: secondReset, newPassword: 'short' })).statusCode, 400);
      await database.pool.query("update password_reset_tokens set created_at = now() - interval '1 hour', expires_at = now() - interval '1 second' where token_digest = $1", [createHash('sha256').update(secondReset).digest('hex')]);
      assert.equal((await post('/password/reset', { token: secondReset, newPassword })).json().status, 'expired');

      // A fresh token is issued directly to avoid consuming the public IP budget.
      await recovery.request(username);
      const resetToken = tokenOf();
      const other = await post('/login', { identifier: username, password: oldPassword });
      assert.equal(other.statusCode, 200);
      const secondCookie = cookieOf(other);
      const sessionList = await app.inject({ method: 'GET', url: '/api/v1/auth/sessions', headers: { cookie: firstCookie } });
      assert.equal(sessionList.json().sessions.length, 2);
      const activeIds = sessionList.json().sessions.map((session: { id: string }) => session.id).sort();
      for (const currentCookie of [firstCookie, secondCookie]) {
        assert.equal((await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { cookie: currentCookie } })).statusCode, 200);
      }
      await email.requestChange(userId, `pending_${suffix}@example.test`, oldPassword);
      const pendingChange = tokenOf();
      const [left, right] = await Promise.all([
        post('/password/reset', { token: resetToken, newPassword }),
        post('/password/reset', { token: resetToken, newPassword })
      ]);
      assert.deepEqual([left.json().status, right.json().status].sort(), ['changed', 'used']);
      for (const formerCookie of [firstCookie, secondCookie]) {
        assert.equal((await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { cookie: formerCookie } })).statusCode, 401);
      }
      assert.deepEqual(revokedIds.sort(), activeIds);
      assert.equal((await database.pool.query('select id from sessions where user_id = $1', [userId])).rows.length, 0);
      assert.equal((await post('/email/verify', { token: pendingChange })).json().status, 'used');
      assert.equal((await post('/login', { identifier: address, password: oldPassword })).statusCode, 401);
      assert.equal((await post('/login', { identifier: address, password: newPassword })).statusCode, 200);
      assert.equal((await post('/login', { identifier: username, password: newPassword })).statusCode, 200);
      const hash = (await database.pool.query<{ password_hash: string }>('select password_hash from users where id = $1', [userId])).rows[0]!.password_hash;
      assert.match(hash, /^\$argon2id\$/);
      assert.equal(hash.includes(newPassword), false);
      assert.equal((await app.inject({ method: 'GET', url: '/api/v1/auth/security', headers: { cookie: cookieOf(unverified) } })).json().emailVerifiedAt, null);

      await recovery.request(username);
      const formerEmailToken = tokenOf();
      await database.pool.query('update users set email = $2, email_normalized = $2, email_verified_at = now() where id = $1', [userId, `changed_${suffix}@example.test`]);
      assert.equal((await post('/password/reset', { token: formerEmailToken, newPassword: oldPassword })).json().status, 'invalid');
      await database.pool.query('update users set email = $2, email_normalized = $2 where id = $1', [userId, address]);
      await database.pool.query('update users set disabled_at = null where id = $1', [disabled.json().user.id]);
      await recovery.request(`disabled_${suffix}`);
      const disabledToken = tokenOf();
      await database.pool.query('update users set disabled_at = now() where id = $1', [disabled.json().user.id]);
      assert.equal((await post('/password/reset', { token: disabledToken, newPassword })).json().status, 'invalid');

      const failureApp = Fastify({ logger: false });
      const disabledApp = Fastify({ logger: false });
      try {
        await failureApp.register(rateLimit, { global: false });
        await failureApp.register(passwordRecoveryRoutes, { prefix: '/api/v1/auth', recovery });
        failMail = true;
        const failed = await failureApp.inject({ method: 'POST', url: '/api/v1/auth/password/recovery', payload: { identifier: username } });
        assert.equal(failed.statusCode, 200);
        assert.deepEqual(failed.json(), generic);
        failMail = false;
        await disabledApp.register(rateLimit, { global: false });
        const unavailableRecovery = new PasswordRecoveryService(database, disabledMailTransport, events);
        await disabledApp.register(passwordRecoveryRoutes, { prefix: '/api/v1/auth', recovery: unavailableRecovery });
        assert.deepEqual((await disabledApp.inject({ method: 'GET', url: '/api/v1/auth/capabilities' })).json(), { passwordRecoveryAvailable: false });
        const unavailable = await disabledApp.inject({ method: 'POST', url: '/api/v1/auth/password/recovery', payload: { identifier: username } });
        assert.equal(unavailable.statusCode, 200);
        assert.deepEqual(unavailable.json(), generic);
      } finally {
        failMail = false;
        await failureApp.close();
        await disabledApp.close();
      }
    } finally {
      await app.close();
      for (const userId of userIds) await database.pool.query('delete from users where id = $1', [userId]);
      await database.pool.end();
    }
  });
