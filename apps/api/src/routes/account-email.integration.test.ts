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
import { MailDeliveryError, type MailMessage, type MailTransport } from '../mail/transport.js';
import { authRoutes } from './auth.js';
import { accountEmailRoutes } from './account-email.js';

const connectionString = process.env.CUBIC_EMAIL_TEST_DATABASE_URL;
const origin = 'http://127.0.0.1:3197';
const password = 'test-only-email-password';

test('email verification, resend, change, expiry, replay, uniqueness and session consequences use digest-only records',
  { skip: !connectionString, timeout: 60_000 }, async () => {
    const database = createDatabase(connectionString!);
    const events = createRealtimeEvents();
    const sessions = createSessionService(database, 30 * 24 * 60 * 60 * 1000);
    const captured: MailMessage[] = [];
    let failDelivery = false;
    const mail: MailTransport = { available: true, publicAppUrl: origin,
      async send(message) { if (failDelivery) throw new MailDeliveryError(); captured.push(message); } };
    const email = new EmailVerificationService(database, mail, events);
    const app = Fastify({ logger: false });
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
    const first = `email_${suffix}`;
    const original = `${first}@example.test`;
    const newAddress = `new_${suffix}@example.test`;
    const occupiedAddress = `occupied_${suffix}@example.test`;
    const userIds: string[] = [];
    const headers = { origin, 'sec-fetch-site': 'same-origin' };
    const cookieOf = (response: { headers: Record<string, unknown> }) => String(response.headers['set-cookie']).split(';', 1)[0] ?? '';
    const tokenOf = () => new URL(captured.at(-1)!.text.match(/https?:\/\/[^\s]+/)![0]).hash.slice('#token='.length);
    const post = (path: string, cookieValue: string | null, payload?: object) => app.inject({ method: 'POST', url: `/api/v1/auth${path}`,
      headers: cookieValue ? { ...headers, cookie: cookieValue } : headers, ...(payload ? { payload } : {}) });
    const register = async (emailAddress: string, username: string) => {
      const response = await post('/register', null, { email: emailAddress, username, displayName: 'Email fixture', password });
      assert.equal(response.statusCode, 201);
      userIds.push(response.json().user.id);
      return response;
    };
    const verify = (token: string) => post('/email/verify', null, { token });
    try {
      await app.register(cookie);
      await app.register(rateLimit, { global: true, max: 300, timeWindow: '1 minute' });
      app.decorateRequest('auth', null);
      app.addHook('onRequest', createBrowserMutationProtection(origin));
      await app.register(authRoutes, { prefix: '/api/v1/auth', database, cookieName: 'session', cookieSecure: false,
        sessionTtlDays: 30, registrationEnabled: true, sessionService: sessions, realtimeEvents: events, emailVerification: email });
      await app.register(accountEmailRoutes, { prefix: '/api/v1/auth', cookieName: 'session', sessionService: sessions, emailVerification: email });

      const registered = await register(original, first);
      assert.equal(registered.json().verificationEmailSent, true);
      assert.equal(JSON.stringify(registered.json()).includes(original), false);
      const currentCookie = cookieOf(registered);
      const userId = registered.json().user.id;
      const security = await app.inject({ method: 'GET', url: '/api/v1/auth/security', headers: { cookie: currentCookie } });
      assert.deepEqual(security.json(), { email: original, emailVerifiedAt: null, mailDeliveryAvailable: true });
      assert.equal((await post('/email/verification', null)).statusCode, 401);
      assert.equal((await post('/email/change', null, { newEmail: newAddress, currentPassword: password })).statusCode, 401);
      const initialToken = tokenOf();
      const stored = await database.pool.query<{ token_digest: string }>('select token_digest from email_verification_tokens where user_id = $1', [userId]);
      assert.equal(stored.rows[0]?.token_digest, createHash('sha256').update(initialToken).digest('hex'));
      assert.equal(stored.rows[0]?.token_digest.includes(initialToken), false);
      assert.equal((await verify('x'.repeat(43))).json().status, 'invalid');

      assert.equal((await post('/email/verification', currentCookie)).statusCode, 200);
      const currentToken = tokenOf();
      assert.equal((await verify(initialToken)).json().status, 'invalid');
      await database.pool.query('update email_verification_tokens set created_at = now() - interval \'2 days\', expires_at = now() - interval \'1 second\' where token_digest = $1',
        [createHash('sha256').update(currentToken).digest('hex')]);
      assert.equal((await verify(currentToken)).json().status, 'expired');
      assert.equal((await post('/email/verification', currentCookie)).statusCode, 200);
      const validCurrent = tokenOf();
      assert.equal((await verify(validCurrent)).json().status, 'verified');
      assert.equal((await verify(validCurrent)).json().status, 'used');
      assert.equal((await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { cookie: currentCookie } })).statusCode, 200);
      assert.ok((await email.state(userId))?.emailVerifiedAt);
      assert.equal((await post('/email/verification', currentCookie)).statusCode, 409);
      assert.equal((await post('/email/verification', currentCookie)).statusCode, 429);

      const secondSession = await post('/login', null, { identifier: first, password });
      assert.equal(secondSession.statusCode, 200);
      const otherCookie = cookieOf(secondSession);
      assert.equal((await post('/email/change', currentCookie, { newEmail: newAddress, currentPassword: 'wrong' })).statusCode, 403);
      assert.equal((await post('/email/change', currentCookie, { newEmail: 'invalid', currentPassword: password })).statusCode, 400);
      assert.equal((await post('/email/change', currentCookie, { newEmail: original, currentPassword: password })).statusCode, 400);
      await register(occupiedAddress, `occupied_${suffix}`);
      assert.equal((await post('/email/change', currentCookie, { newEmail: occupiedAddress, currentPassword: password })).statusCode, 409);
      assert.equal((await post('/email/change', currentCookie, { newEmail: ` NEW_${suffix}@EXAMPLE.TEST `, currentPassword: password })).statusCode, 200);
      const firstChange = tokenOf();
      assert.equal((await email.state(userId))?.email, original);
      assert.equal((await post('/email/change', currentCookie, { newEmail: `NEW_${suffix}@EXAMPLE.TEST`, currentPassword: password })).statusCode, 429);
      // The previous three rejected attempts count toward the dedicated five-attempt limit.
      const firstDigest = createHash('sha256').update(firstChange).digest('hex');
      await database.pool.query('update email_verification_tokens set created_at = now() - interval \'2 days\', expires_at = now() - interval \'1 second\' where token_digest = $1', [firstDigest]);
      assert.equal((await verify(firstChange)).json().status, 'expired');

      // Service-level issuance uses a fresh test actor to cover supersession and delivery failure.
      const alternate = await register(`alternate_${suffix}@example.test`, `alternate_${suffix}`);
      const alternateId = alternate.json().user.id;
      failDelivery = true;
      const failedRegistration = await register(`delivery_failed_${suffix}@example.test`, `delivery_failed_${suffix}`);
      const failedRegistrationId = failedRegistration.json().user.id;
      assert.equal(failedRegistration.json().verificationEmailSent, false);
      assert.equal(JSON.stringify(failedRegistration.json()).includes('token'), false);
      assert.equal((await email.state(failedRegistrationId))?.emailVerifiedAt, null);
      assert.equal((await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { cookie: cookieOf(failedRegistration) } })).statusCode, 200);
      assert.equal((await post('/login', null, { identifier: `delivery_failed_${suffix}`, password })).statusCode, 200);
      assert.equal((await database.pool.query('select email from users where id = $1', [failedRegistrationId])).rows[0]?.email, `delivery_failed_${suffix}@example.test`);
      await assert.rejects(email.requestChange(alternateId, `failed_${suffix}@example.test`, password), MailDeliveryError);
      assert.equal((await email.state(alternateId))?.email, `alternate_${suffix}@example.test`);
      failDelivery = false;
      await email.requestChange(alternateId, `FINAL_${suffix}@EXAMPLE.TEST`, password);
      const superseded = tokenOf();
      await email.requestChange(alternateId, `FINAL_${suffix}@EXAMPLE.TEST`, password);
      const finalToken = tokenOf();
      assert.equal((await verify(superseded)).json().status, 'invalid');
      const alternateSecondSession = await post('/login', null, { identifier: `alternate_${suffix}`, password });
      assert.equal(alternateSecondSession.statusCode, 200);
      const alternateFirstCookie = cookieOf(alternate);
      const alternateSecondCookie = cookieOf(alternateSecondSession);
      for (const activeCookie of [alternateFirstCookie, alternateSecondCookie]) {
        assert.equal((await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { cookie: activeCookie } })).statusCode, 200);
      }
      const [left, right] = await Promise.all([verify(finalToken), verify(finalToken)]);
      assert.deepEqual([left.json().status, right.json().status].sort(), ['changed', 'used']);
      assert.equal((await email.state(alternateId))?.email, `final_${suffix}@example.test`);
      assert.equal((await email.state(alternateId))?.emailVerifiedAt !== null, true);
      for (const revokedCookie of [alternateFirstCookie, alternateSecondCookie]) {
        assert.equal((await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { cookie: revokedCookie } })).statusCode, 401);
      }
      assert.equal((await post('/login', null, { identifier: `alternate_${suffix}@example.test`, password })).statusCode, 401);
      assert.equal((await post('/login', null, { identifier: `final_${suffix}@example.test`, password })).statusCode, 200);
      assert.equal((await post('/login', null, { identifier: `alternate_${suffix}`, password })).statusCode, 200);
      assert.equal((await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { cookie: otherCookie } })).statusCode, 200);
    } finally {
      await app.close();
      for (const userId of userIds) await database.pool.query('delete from users where id = $1', [userId]);
      await database.pool.end();
    }
  });
