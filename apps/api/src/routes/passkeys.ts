import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';
import { z } from 'zod';
import { createRequireAuth } from '../auth/guard.js';
import type { SessionService } from '../security/session.js';
import { PasskeyError, PasskeyService } from '../security/passkeys.js';
import { PasskeyAuthenticationError, PasskeyAuthenticationService } from '../security/passkey-authentication.js';
import type { RealtimeEvents } from '../realtime/events.js';

const passwordBody = z.object({ currentPassword: z.string().min(1).max(128) });
const completeBody = z.object({
  challengeId: z.uuid(),
  response: z.unknown(),
  label: z.string().trim().min(1).max(64).default('Passkey')
});
const removeBody = z.object({ currentPassword: z.string().min(1).max(128) });
const params = z.object({ id: z.uuid() });
const renameBody = z.strictObject({ label: z.string().transform((value) => value.trim().normalize('NFC'))
  .pipe(z.string().min(1).max(64).refine((value) => !/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(value))) });

interface Options { sessionService: SessionService; cookieName: string; cookieSecure: boolean; sessionTtlDays: number; passkeys: PasskeyService; authentication: PasskeyAuthenticationService; realtimeEvents: RealtimeEvents }
const limited = (groupId: string, max = 5) => ({ max, timeWindow: '10 minutes', hook: 'preHandler' as const,
  groupId, keyGenerator: (request: FastifyRequest) => request.auth?.user.id ?? request.ip });

export const passkeyRoutes: FastifyPluginAsync<Options> = async (app, options) => {
  const requireAuth = createRequireAuth(options.sessionService, options.cookieName);
  const loginError = { error: 'Passkey sign-in could not be completed.' };
  app.post('/passkeys/authentication/options', { config: { rateLimit: { max: 20, timeWindow: '10 minutes', groupId: 'passkey-login-options' } } },
    async (_request, reply) => reply.send(await options.authentication.begin()));
  app.post('/passkeys/authentication/complete', { config: { rateLimit: { max: 30, timeWindow: '10 minutes', groupId: 'passkey-login-complete' } } },
    async (request, reply) => {
      const parsed = z.object({ challengeId: z.uuid(), response: z.unknown() }).safeParse(request.body);
      if (!parsed.success) return reply.code(401).send(loginError);
      try {
        const result = await options.authentication.complete(parsed.data.challengeId,
          parsed.data.response as AuthenticationResponseJSON, options.sessionTtlDays, request.headers['user-agent']);
        const previousToken = request.cookies[options.cookieName];
        if (previousToken) {
          try {
            const previousSessionId = await options.sessionService.destroyToken(previousToken);
            if (previousSessionId) options.realtimeEvents.emitSessionRevoked({ sessionId: previousSessionId });
          } catch (error) {
            await options.sessionService.destroyToken(result.session.token).catch(() => {});
            throw error;
          }
        }
        reply.setCookie(options.cookieName, result.session.token, {
          httpOnly: true, sameSite: 'lax', secure: options.cookieSecure, path: '/',
          expires: result.session.expiresAt, maxAge: options.sessionTtlDays * 24 * 60 * 60
        });
        return reply.send({ user: result.user });
      } catch (error) {
        if (error instanceof PasskeyAuthenticationError) return reply.code(401).send(loginError);
        throw error;
      }
    });
  app.get('/passkeys', { preHandler: requireAuth }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: 'Authentication required.' });
    return reply.send({ passkeys: await options.passkeys.list(request.auth.user.id) });
  });
  app.patch('/passkeys/:id', { preHandler: requireAuth, config: { rateLimit: limited('passkey-rename', 20) } }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: 'Authentication required.' });
    const parsedParams = params.safeParse(request.params);
    const parsedBody = renameBody.safeParse(request.body);
    if (!parsedParams.success || !parsedBody.success) return reply.code(400).send({ error: 'Enter a passkey name between 1 and 64 characters.' });
    try {
      return reply.send({ passkey: await options.passkeys.rename(request.auth.user.id, parsedParams.data.id, parsedBody.data.label) });
    } catch (error) {
      if (error instanceof PasskeyError && error.reason === 'missing') return reply.code(404).send({ error: 'Passkey not found.' });
      throw error;
    }
  });
  app.post('/passkeys/options', { preHandler: requireAuth, config: { rateLimit: limited('passkey-options') } }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: 'Authentication required.' });
    const parsed = passwordBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Enter your current password.' });
    try {
      return reply.send(await options.passkeys.begin(request.auth.user.id, request.auth.sessionId, parsed.data.currentPassword));
    } catch (error) {
      if (error instanceof PasskeyError) return reply.code(error.reason === 'password' ? 403 : 409).send({
        error: error.reason === 'password' ? 'Current password is incorrect.' : 'A verified email is required to add a passkey.'
      });
      throw error;
    }
  });
  app.post('/passkeys/complete', { preHandler: requireAuth, config: { rateLimit: limited('passkey-complete', 20) } }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: 'Authentication required.' });
    const parsed = completeBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Could not verify the passkey.' });
    try {
      await options.passkeys.complete(request.auth.user.id, request.auth.sessionId, parsed.data.challengeId,
        parsed.data.response as RegistrationResponseJSON, parsed.data.label);
      return reply.code(201).send({ passkeys: await options.passkeys.list(request.auth.user.id) });
    } catch (error) {
      if (error instanceof PasskeyError) return reply.code(error.reason === 'duplicate' ? 409 : 400).send({ error:
        error.reason === 'expired' ? 'Passkey setup expired. Try again.' :
          error.reason === 'duplicate' ? 'This passkey is already registered.' : 'Could not verify the passkey. Try again.' });
      throw error;
    }
  });
  app.delete('/passkeys/:id', { preHandler: requireAuth, config: { rateLimit: limited('passkey-remove') } }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: 'Authentication required.' });
    const parsedParams = params.safeParse(request.params);
    const parsedBody = removeBody.safeParse(request.body);
    if (!parsedParams.success || !parsedBody.success) return reply.code(400).send({ error: 'Enter your current password.' });
    try {
      await options.passkeys.remove(request.auth.user.id, request.auth.sessionId, parsedParams.data.id, parsedBody.data.currentPassword);
      return reply.code(204).send();
    } catch (error) {
      if (error instanceof PasskeyError) return reply.code(error.reason === 'password' ? 403 : error.reason === 'missing' ? 404 : 401).send({ error:
        error.reason === 'password' ? 'Current password is incorrect.' :
          error.reason === 'missing' ? 'Passkey not found.' : 'Authentication required.' });
      throw error;
    }
  });
};
