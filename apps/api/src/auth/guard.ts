import type { FastifyReply, FastifyRequest } from 'fastify';
import type { SessionService } from '../security/session.js';

export function createRequireAuth(sessionService: SessionService, cookieName: string) {
  return async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const token = request.cookies[cookieName];

    if (!token) {
      await reply.code(401).send({ error: 'Authentication required.' });
      return;
    }

    const identity = await sessionService.resolveToken(token, { activity: true });

    if (!identity) {
      reply.clearCookie(cookieName, { path: '/' });
      await reply.code(401).send({ error: 'Authentication required.' });
      return;
    }

    request.auth = identity;
  };
}
