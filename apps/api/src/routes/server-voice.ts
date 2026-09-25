import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { SessionService } from '../security/session.js';
import { createRequireAuth } from '../auth/guard.js';
import { InvalidServerVoiceWebhookError, ServerVoiceDeniedError, type ServerVoiceService } from '../server-voice/service.js';

export interface ServerVoiceRoutesOptions {
  cookieName: string;
  sessionService: SessionService;
  service: ServerVoiceService;
}

const channelParams = z.object({ channelId: z.string().uuid() });

export const serverVoiceRoutes: FastifyPluginAsync<ServerVoiceRoutesOptions> = async (app, options) => {
  const requireAuth = createRequireAuth(options.sessionService, options.cookieName);
  app.post('/channels/:channelId/token', { preHandler: requireAuth }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: 'Authentication required.' });
    const parsed = channelParams.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid voice channel.' });
    try {
      const ticket = await options.service.issueTicket({
        channelId: parsed.data.channelId,
        sessionId: request.auth.sessionId,
        userId: request.auth.user.id,
        displayName: request.auth.user.displayName
      });
      reply.header('cache-control', 'no-store');
      return ticket;
    } catch (error) {
      if (error instanceof ServerVoiceDeniedError) return reply.code(404).send({ error: 'Voice channel unavailable.' });
      throw error;
    }
  });
};

export const serverVoiceWebhookRoutes: FastifyPluginAsync<{ service: ServerVoiceService }> = async (app, options) => {
  // LiveKit signs the exact raw body; parsing and reserializing JSON invalidates the digest.
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser(['application/json', 'application/webhook+json'],
    { parseAs: 'string', bodyLimit: 256 * 1024 }, (_request, body, done) => done(null, body));
  app.post('/webhook', async (request, reply) => {
    if (typeof request.body !== 'string') return reply.code(400).send({ error: 'Invalid webhook.' });
    const auth = request.headers.authorization;
    try {
      await options.service.receiveWebhook(request.body, auth);
      return reply.code(204).send();
    } catch (error) {
      if (error instanceof InvalidServerVoiceWebhookError) return reply.code(401).send({ error: 'Invalid webhook.' });
      return reply.code(503).send({ error: 'Voice presence temporarily unavailable.' });
    }
  });
};
