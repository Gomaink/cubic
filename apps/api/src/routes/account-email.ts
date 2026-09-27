import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { SessionService } from '../security/session.js';
import { createRequireAuth } from '../auth/guard.js';
import { EmailChangeError, EmailVerificationService } from '../mail/email-verification.js';
import { MailDeliveryError } from '../mail/transport.js';

const changeBody = z.object({
  newEmail: z.string().trim().email().max(254),
  currentPassword: z.string().min(1).max(128)
});
const tokenBody = z.object({ token: z.string().max(128) });

interface Options {
  cookieName: string;
  sessionService: SessionService;
  emailVerification: EmailVerificationService;
}

export const accountEmailRoutes: FastifyPluginAsync<Options> = async (app, options) => {
  const requireAuth = createRequireAuth(options.sessionService, options.cookieName);

  app.get('/security', { preHandler: requireAuth }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: 'Authentication required.' });
    const state = await options.emailVerification.state(request.auth.user.id);
    if (!state) return reply.code(401).send({ error: 'Authentication required.' });
    return reply.send(state);
  });

  app.post('/email/verification', { preHandler: requireAuth, config: { rateLimit: {
    max: 3, timeWindow: '15 minutes', hook: 'preHandler', groupId: 'email-verification-resend',
    keyGenerator: (request) => request.auth?.user.id ?? request.ip
  } } }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: 'Authentication required.' });
    if (!options.emailVerification.available) return reply.code(503).send({ error: 'Email delivery is not configured.' });
    try {
      const result = await options.emailVerification.sendCurrent(request.auth.user.id);
      if (result === 'already_verified') return reply.code(409).send({ error: 'This email is already verified.' });
      if (result === 'unavailable') return reply.code(503).send({ error: 'Email delivery is not configured.' });
      return reply.send({ message: 'Verification email sent.' });
    } catch {
      return reply.code(503).send({ error: 'Email delivery is temporarily unavailable. Try again later.' });
    }
  });

  app.post('/email/change', { preHandler: requireAuth, config: { rateLimit: {
    max: 5, timeWindow: '10 minutes', hook: 'preHandler', groupId: 'email-change',
    keyGenerator: (request) => request.auth?.user.id ?? request.ip
  } } }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: 'Authentication required.' });
    if (!options.emailVerification.available) return reply.code(503).send({ error: 'Email delivery is not configured.' });
    const parsed = changeBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Enter a valid new email and current password.' });
    try {
      await options.emailVerification.requestChange(request.auth.user.id, parsed.data.newEmail, parsed.data.currentPassword);
      return reply.send({ message: 'Verification email sent to the new address. Your current email remains unchanged until verification.' });
    } catch (error) {
      if (error instanceof EmailChangeError) {
        if (error.reason === 'password') return reply.code(403).send({ error: 'Current password is incorrect.' });
        if (error.reason === 'same') return reply.code(400).send({ error: 'Enter a different email address.' });
        if (error.reason === 'occupied') return reply.code(409).send({ error: 'That email address is unavailable.' });
      }
      if (error instanceof MailDeliveryError) return reply.code(503).send({ error: error.message });
      return reply.code(503).send({ error: 'Email change is temporarily unavailable. Try again later.' });
    }
  });

  app.post('/email/verify', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (request, reply) => {
    const parsed = tokenBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ status: 'invalid' });
    try {
      const status = await options.emailVerification.consume(parsed.data.token);
      return reply.code(status === 'verified' || status === 'changed' ? 200 : status === 'conflict' ? 409 : 400).send({ status });
    } catch {
      return reply.code(503).send({ status: 'unavailable' });
    }
  });
};
