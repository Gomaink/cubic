import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { PasswordRecoveryService } from '../mail/password-recovery.js';
import { passwordPolicySchema } from './auth.js';

const requestBody = z.object({ identifier: z.string().trim().min(1).max(254) });
const resetBody = z.object({ token: z.string().max(128), newPassword: passwordPolicySchema });
const genericResponse = { message: 'If an eligible account exists, password reset instructions have been sent.' };

export const passwordRecoveryRoutes: FastifyPluginAsync<{ recovery: PasswordRecoveryService }> = async (app, options) => {
  app.get('/capabilities', async () => ({ passwordRecoveryAvailable: options.recovery.available }));

  app.post('/password/recovery', { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } } }, async (request, reply) => {
    const parsed = requestBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Enter an email or username.' });
    try {
      await options.recovery.request(parsed.data.identifier);
    } catch {
      // Public response never discloses account state or mail-provider failure.
    }
    return reply.send(genericResponse);
  });

  app.post('/password/reset', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (request, reply) => {
    const parsed = resetBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ status: 'invalid' });
    try {
      const status = await options.recovery.consume(parsed.data.token, parsed.data.newPassword);
      return reply.code(status === 'changed' ? 200 : 400).send({ status });
    } catch {
      return reply.code(503).send({ status: 'unavailable' });
    }
  });
};
