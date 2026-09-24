import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { Database } from '@cubic/database';
import { createRequireAuth } from '../auth/guard.js';
import type { SessionService } from '../security/session.js';
import { SessionPersistenceError } from '../security/session.js';
import { joinServerViaInviteLink, previewServerInviteLink, validInviteLinkToken } from '../servers/invite-links.js';

interface InviteLinkRoutesOptions {
  database: Database;
  cookieName: string;
  sessionService: SessionService;
}

const tokenBody = z.object({ token: z.string() });
const unavailable = { error: 'Invite unavailable.' };

export const serverInviteLinkRoutes: FastifyPluginAsync<InviteLinkRoutesOptions> = async (app, options) => {
  const requireAuth = createRequireAuth(options.sessionService, options.cookieName);

  app.post('/preview', { bodyLimit: 256, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request, reply) => {
    reply.header('cache-control', 'no-store');
    const parsed = tokenBody.safeParse(request.body);
    if (!parsed.success || !validInviteLinkToken(parsed.data.token)) return reply.code(404).send(unavailable);
    let actorId: string | undefined;
    const sessionToken = request.cookies[options.cookieName];
    if (sessionToken) {
      try {
        actorId = (await options.sessionService.resolveToken(sessionToken, { activity: false }))?.user.id;
      } catch (error) {
        if (error instanceof SessionPersistenceError) return reply.code(503).send({ error: 'Session service is temporarily unavailable.' });
        throw error;
      }
    }
    const result = await previewServerInviteLink(options.database, parsed.data.token, actorId);
    if ('denied' in result) return reply.code(404).send(unavailable);
    return { valid: true, ...result.value };
  });

  app.post('/join', { bodyLimit: 256, preHandler: requireAuth, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (request, reply) => {
    reply.header('cache-control', 'no-store');
    if (!request.auth) return reply.code(401).send({ error: 'Authentication required.' });
    const parsed = tokenBody.safeParse(request.body);
    if (!parsed.success || !validInviteLinkToken(parsed.data.token)) return reply.code(404).send(unavailable);
    const result = await joinServerViaInviteLink(options.database, parsed.data.token, request.auth.user.id);
    if ('denied' in result) return reply.code(404).send(unavailable);
    return result.value;
  });
};
