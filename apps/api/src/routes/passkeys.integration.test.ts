import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { chromium } from '@playwright/test';
import { createDatabase } from '@cubic/database';
import { createBrowserMutationProtection } from '../security/browser-request.js';
import { createSessionService } from '../security/session.js';
import { hashPassword } from '../security/password.js';
import { PasskeyError, PasskeyService } from '../security/passkeys.js';
import { passkeyRoutes } from './passkeys.js';
import { PasskeyAuthenticationError, PasskeyAuthenticationService } from '../security/passkey-authentication.js';
import { createRealtimeEvents } from '../realtime/events.js';

const connectionString = process.env.CUBIC_PASSKEY_TEST_DATABASE_URL;
const origin = 'http://localhost:3203';
const password = 'test-only-password';
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

test('passkey registration uses verified password, session-bound one-time challenge and real authenticator verification',
  { skip: !connectionString, timeout: 90_000 }, async () => {
    const database = createDatabase(connectionString!);
    const sessions = createSessionService(database, 30 * 24 * 60 * 60 * 1000);
    const service = new PasskeyService(database, 'localhost', 'Cubic', origin);
    const wrongRP = new PasskeyService(database, 'wrong.example', 'Cubic', origin);
    const app = Fastify({ logger: false });
    const suffix = randomUUID().slice(0, 8);
    const userIds: string[] = [];
    let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
    const createUser = async (name: string, verified: boolean) => {
      const result = await database.pool.query<{ id: string }>(
        'insert into users (email, email_normalized, username, username_normalized, display_name, password_hash, email_verified_at) values ($1, $1, $2, $2, $3, $4, $5) returning id',
        [`${name}@example.test`, name, 'Passkey fixture', await hashPassword(password), verified ? new Date() : null]
      );
      const id = result.rows[0]!.id;
      userIds.push(id);
      const session = await sessions.create(id, 30);
      const identity = await sessions.resolveToken(session.token);
      return { id, cookie: `cubic_session=${session.token}`, sessionId: identity!.sessionId };
    };
    const post = (path: string, payload: object, sessionCookie?: string) => app.inject({ method: 'POST', url: `/api/v1/auth${path}`,
      headers: { origin, 'sec-fetch-site': 'same-origin', ...(sessionCookie ? { cookie: sessionCookie } : {}) }, payload });
    try {
      await app.register(cookie);
      await app.register(rateLimit, { global: true, max: 300, timeWindow: '1 minute' });
      app.decorateRequest('auth', null);
      app.addHook('onRequest', createBrowserMutationProtection(origin));
      await app.register(passkeyRoutes, { prefix: '/api/v1/auth', cookieName: 'cubic_session', cookieSecure: false,
        sessionTtlDays: 30, sessionService: sessions, passkeys: service,
        authentication: new PasskeyAuthenticationService(database, sessions, 'localhost', origin), realtimeEvents: createRealtimeEvents() });
      const library = await readFile(new URL('../../../../node_modules/@simplewebauthn/browser/dist/bundle/index.umd.min.js', import.meta.url));
      app.get('/test', async (_request, reply) => reply.type('text/html').send('<!doctype html><title>Passkey test</title>'));
      app.get('/library', async (_request, reply) => reply.type('application/javascript').send(library));
      await app.listen({ host: '127.0.0.1', port: 3203 });
      const owner = await createUser(`pk_${suffix}`, true);
      const secondOwnerSession = await sessions.create(owner.id, 30);
      const secondOwnerCookie = `cubic_session=${secondOwnerSession.token}`;
      const other = await createUser(`other_${suffix}`, true);
      const unverified = await createUser(`unverified_${suffix}`, false);
      assert.equal((await post('/passkeys/options', { currentPassword: password })).statusCode, 401);
      assert.equal((await post('/passkeys/options', { currentPassword: password }, unverified.cookie)).statusCode, 409);
      assert.equal((await post('/passkeys/options', { currentPassword: 'wrong-password' }, owner.cookie)).statusCode, 403);
      assert.equal((await app.inject({ method: 'GET', url: '/api/v1/auth/passkeys' })).statusCode, 401);
      const first = (await post('/passkeys/options', { currentPassword: password }, owner.cookie)).json();
      assert.equal(first.options.rp.id, 'localhost');
      assert.equal(first.options.authenticatorSelection.residentKey, 'required');
      assert.equal(first.options.attestation, 'none');
      const challengeRow = (await database.pool.query<{ challenge_digest: string; user_id: string; session_id: string; expires_at: Date; created_at: Date }>(
        'select challenge_digest, user_id, session_id, expires_at, created_at from passkey_challenges where id = $1', [first.challengeId])).rows[0]!;
      assert.equal(challengeRow.challenge_digest, digest(first.options.challenge));
      assert.notEqual(challengeRow.challenge_digest, first.options.challenge);
      assert.equal(challengeRow.user_id, owner.id);
      assert.equal(challengeRow.session_id, owner.sessionId);
      assert.ok(Math.abs(challengeRow.expires_at.getTime() - challengeRow.created_at.getTime() - 300_000) < 5_000);
      const second = (await post('/passkeys/options', { currentPassword: password }, owner.cookie)).json();
      assert.equal((await post('/passkeys/complete', { challengeId: first.challengeId, response: {}, label: 'Old' }, owner.cookie)).statusCode, 400);
      assert.equal((await post('/passkeys/complete', { challengeId: second.challengeId, response: {}, label: 'Invalid' }, owner.cookie)).statusCode, 400);

      browser = await chromium.launch({ headless: true });
      const context = await browser.newContext();
      const page = await context.newPage();
      const cdp = await context.newCDPSession(page);
      await cdp.send('WebAuthn.enable');
      await cdp.send('WebAuthn.addVirtualAuthenticator', { options: {
        protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true
      } });
      await page.goto(`${origin}/test`);
      await page.addScriptTag({ url: `${origin}/library` });
      const createResponse = (options: unknown) => page.evaluate(async (registrationOptions) =>
        (globalThis as unknown as { SimpleWebAuthnBrowser: { startRegistration: (arg: { optionsJSON: unknown }) => Promise<unknown> } }).SimpleWebAuthnBrowser.startRegistration({ optionsJSON: registrationOptions }), options);
      const response = await createResponse(second.options);
      assert.equal((await post('/passkeys/complete', { challengeId: second.challengeId, response, label: 'Wrong session' }, other.cookie)).statusCode, 400);
      assert.equal((await post('/passkeys/complete', { challengeId: second.challengeId, response, label: 'Wrong session' }, secondOwnerCookie)).statusCode, 400);
      const wrongOrigin = structuredClone(response) as { response: { clientDataJSON: string } };
      const clientData = JSON.parse(Buffer.from(wrongOrigin.response.clientDataJSON, 'base64url').toString());
      wrongOrigin.response.clientDataJSON = Buffer.from(JSON.stringify({ ...clientData, origin: 'https://evil.example' })).toString('base64url');
      assert.equal((await post('/passkeys/complete', { challengeId: second.challengeId, response: wrongOrigin, label: 'Wrong origin' }, owner.cookie)).statusCode, 400);
      await assert.rejects(() => wrongRP.complete(owner.id, owner.sessionId, second.challengeId, response as never, 'Wrong RP'),
        (error: unknown) => error instanceof PasskeyError && error.reason === 'invalid');
      await database.pool.query("update passkey_challenges set created_at = now() - interval '10 minutes', expires_at = now() - interval '1 second' where id = $1", [second.challengeId]);
      assert.equal((await post('/passkeys/complete', { challengeId: second.challengeId, response, label: 'Expired' }, owner.cookie)).statusCode, 400);

      const third = (await post('/passkeys/options', { currentPassword: password }, owner.cookie)).json();
      const validResponse = await createResponse(third.options);
      const responseWithInjectedTransports = structuredClone(validResponse) as {
        response: { transports?: string[] };
      };
      responseWithInjectedTransports.response.transports = [
        'internal',
        'internal',
        'definitely-not-webauthn'
      ];
      const results = await Promise.all([
        post('/passkeys/complete', { challengeId: third.challengeId, response: responseWithInjectedTransports, label: 'Test device' }, owner.cookie),
        post('/passkeys/complete', { challengeId: third.challengeId, response: responseWithInjectedTransports, label: 'Test device' }, owner.cookie)
      ]);
      assert.deepEqual(results.map((result) => result.statusCode).sort(), [201, 400]);
      const owned = (await app.inject({ method: 'GET', url: '/api/v1/auth/passkeys', headers: { cookie: owner.cookie } })).json().passkeys;
      assert.equal(owned.length, 1);
      assert.equal(owned[0].label, 'Test device');
      assert.equal('publicKey' in owned[0], false);
      assert.equal('credentialId' in owned[0], false);
      const credential = (await database.pool.query<{ credential_id: string; public_key: string; transports: string[] }>(
        'select credential_id, public_key, transports from passkey_credentials where user_id = $1', [owner.id])).rows[0]!;
      assert.ok(credential.credential_id.length > 20);
      assert.ok(credential.public_key.length > 20);
      assert.deepEqual(credential.transports, ['internal']);
      await assert.rejects(() => database.pool.query(
        'insert into passkey_credentials (user_id, credential_id, public_key, counter, device_type, backed_up, label) values ($1, $2, $3, 0, $4, false, $5)',
        [other.id, credential.credential_id, credential.public_key, 'singleDevice', 'Duplicate']
      ), (error: unknown) => (error as { code?: string }).code === '23505');
      assert.deepEqual((await app.inject({ method: 'GET', url: '/api/v1/auth/passkeys', headers: { cookie: other.cookie } })).json().passkeys, []);
      const fourth = (await post('/passkeys/options', { currentPassword: password }, owner.cookie)).json();

      const challengeRows = await database.pool.query<{ id: string }>(
        "select id from passkey_challenges where user_id = $1 and session_id = $2 and purpose = 'enroll'",
        [owner.id, owner.sessionId]
      );
      assert.deepEqual(
        challengeRows.rows.map((row) => row.id),
        [fourth.challengeId]
      );

      assert.equal(fourth.options.excludeCredentials[0].id, credential.credential_id);
      assert.deepEqual(fourth.options.excludeCredentials[0].transports, ['internal']);
      const authenticationOptions = (await post('/passkeys/authentication/options', {})).json();
      assert.deepEqual(authenticationOptions.options.allowCredentials, []);
      assert.equal(authenticationOptions.options.userVerification, 'required');
      assert.equal('userId' in authenticationOptions, false);
      const loginChallenge = (await database.pool.query<{ challenge_digest: string; expires_at: Date; created_at: Date }>(
        'select challenge_digest, expires_at, created_at from passkey_authentication_challenges where id = $1',
        [authenticationOptions.challengeId])).rows[0]!;
      assert.equal(loginChallenge.challenge_digest, digest(authenticationOptions.options.challenge));
      assert.notEqual(loginChallenge.challenge_digest, authenticationOptions.options.challenge);
      assert.ok(Math.abs(loginChallenge.expires_at.getTime() - loginChallenge.created_at.getTime() - 300_000) < 5_000);
      const authenticate = (authenticationOptionsValue: unknown) => page.evaluate(async (optionsJSON) =>
        (globalThis as unknown as { SimpleWebAuthnBrowser: { startAuthentication: (arg: { optionsJSON: unknown }) => Promise<unknown> } }).SimpleWebAuthnBrowser.startAuthentication({ optionsJSON }), authenticationOptionsValue);
      const assertion = await authenticate(authenticationOptions.options);
      const beforeLoginSessions = Number((await database.pool.query<{ count: string }>(
        'select count(*) from sessions where user_id = $1', [owner.id])).rows[0]!.count);
      const loginResults = await Promise.all([
        post('/passkeys/authentication/complete', { challengeId: authenticationOptions.challengeId, response: assertion }),
        post('/passkeys/authentication/complete', { challengeId: authenticationOptions.challengeId, response: assertion })
      ]);
      assert.deepEqual(loginResults.map((result) => result.statusCode).sort(), [200, 401]);
      const loginSuccess = loginResults.find((result) => result.statusCode === 200)!;
      assert.equal(loginSuccess.json().user.id, owner.id);
      const loginCookie = loginSuccess.cookies.find((entry) => entry.name === 'cubic_session')!;
      assert.equal(loginCookie.httpOnly, true);
      assert.equal(loginCookie.sameSite, 'Lax');
      assert.notEqual(loginCookie.secure, true);
      assert.equal((await sessions.resolveToken(loginCookie.value))?.user.id, owner.id);
      assert.equal(Number((await database.pool.query<{ count: string }>(
        'select count(*) from sessions where user_id = $1', [owner.id])).rows[0]!.count), beforeLoginSessions + 1);
      const usedCredential = (await database.pool.query<{ counter: string; last_used_at: Date | null }>(
        'select counter, last_used_at from passkey_credentials where user_id = $1', [owner.id])).rows[0]!;
      assert.ok(Number(usedCredential.counter) >= 0);
      assert.ok(usedCredential.last_used_at);
      assert.equal((await post('/passkeys/authentication/complete', { challengeId: authenticationOptions.challengeId, response: assertion })).statusCode, 401);

      const securityOptions = (await post('/passkeys/authentication/options', {})).json();
      const securityAssertion = await authenticate(securityOptions.options);
      const wrongCredential = structuredClone(securityAssertion) as { id: string };
      wrongCredential.id = 'random-credential';
      assert.equal((await post('/passkeys/authentication/complete', { challengeId: securityOptions.challengeId, response: wrongCredential })).statusCode, 401);
      const wrongLoginOrigin = structuredClone(securityAssertion) as { response: { clientDataJSON: string } };
      const loginClientData = JSON.parse(Buffer.from(wrongLoginOrigin.response.clientDataJSON, 'base64url').toString());
      wrongLoginOrigin.response.clientDataJSON = Buffer.from(JSON.stringify({ ...loginClientData, origin: 'https://evil.example' })).toString('base64url');
      assert.equal((await post('/passkeys/authentication/complete', { challengeId: securityOptions.challengeId, response: wrongLoginOrigin })).statusCode, 401);
      const wrongLoginRP = new PasskeyAuthenticationService(database, sessions, 'wrong.example', origin);
      await assert.rejects(() => wrongLoginRP.complete(securityOptions.challengeId, securityAssertion as never, 30), PasskeyAuthenticationError);
      await database.pool.query('update users set email_verified_at = null where id = $1', [owner.id]);
      assert.equal((await post('/passkeys/authentication/complete', { challengeId: securityOptions.challengeId, response: securityAssertion })).statusCode, 401);
      await database.pool.query('update users set email_verified_at = now(), disabled_at = now() where id = $1', [owner.id]);
      assert.equal((await post('/passkeys/authentication/complete', { challengeId: securityOptions.challengeId, response: securityAssertion })).statusCode, 401);
      await database.pool.query('update users set disabled_at = null where id = $1', [owner.id]);
      const malformedSignature = structuredClone(securityAssertion) as { response: { signature: string } };
      malformedSignature.response.signature = 'invalid-signature';
      assert.equal((await post('/passkeys/authentication/complete', { challengeId: securityOptions.challengeId, response: malformedSignature })).statusCode, 401);
      assert.equal((await post('/passkeys/authentication/complete', { challengeId: securityOptions.challengeId, response: securityAssertion })).statusCode, 200);

      const expiredOptions = (await post('/passkeys/authentication/options', {})).json();
      await database.pool.query("update passkey_authentication_challenges set created_at = now() - interval '10 minutes', expires_at = now() - interval '1 second' where id = $1", [expiredOptions.challengeId]);
      assert.equal((await post('/passkeys/authentication/complete', { challengeId: expiredOptions.challengeId, response: assertion })).statusCode, 401);
      assert.equal((await post('/passkeys/authentication/complete', { challengeId: randomUUID(), response: assertion })).statusCode, 401);
      const removedOptions = (await post('/passkeys/authentication/options', {})).json();
      assert.equal((await database.pool.query('select id from passkey_authentication_challenges where id = $1',
        [expiredOptions.challengeId])).rowCount, 0);
      const removedAssertion = await authenticate(removedOptions.options);
      assert.equal((await app.inject({ method: 'DELETE', url: `/api/v1/auth/passkeys/${owned[0].id}`, headers: { origin, cookie: other.cookie }, payload: { currentPassword: password } })).statusCode, 404);
      assert.equal((await app.inject({ method: 'DELETE', url: `/api/v1/auth/passkeys/${owned[0].id}`, headers: { origin, cookie: owner.cookie }, payload: { currentPassword: 'wrong-password' } })).statusCode, 403);
      assert.equal((await app.inject({ method: 'DELETE', url: `/api/v1/auth/passkeys/${owned[0].id}`, headers: { origin } })).statusCode, 401);
      assert.equal((await app.inject({ method: 'DELETE', url: `/api/v1/auth/passkeys/${owned[0].id}`, headers: { origin, cookie: owner.cookie }, payload: { currentPassword: password } })).statusCode, 204);
      assert.equal((await post('/passkeys/authentication/complete', { challengeId: removedOptions.challengeId, response: removedAssertion })).statusCode, 401);
      assert.equal((await database.pool.query('select id from passkey_credentials where user_id = $1', [owner.id])).rows.length, 0);
      assert.equal((await app.inject({ method: 'GET', url: '/api/v1/auth/passkeys', headers: { cookie: owner.cookie } })).statusCode, 200);
      assert.equal((await app.inject({ method: 'GET', url: '/api/v1/auth/passkeys', headers: { cookie: secondOwnerCookie } })).statusCode, 200);
      let optionsRateLimited = false;
      for (let attempt = 0; attempt < 25; attempt += 1) {
        if ((await post('/passkeys/authentication/options', {})).statusCode === 429) {
          optionsRateLimited = true;
          break;
        }
      }
      assert.equal(optionsRateLimited, true);
    } finally {
      await browser?.close();
      await app.close();
      for (const id of userIds) await database.pool.query('delete from users where id = $1', [id]);
      await database.pool.end();
    }
  });
