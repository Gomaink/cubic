import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Database } from '@cubic/database';
import { resolveSession } from '../security/session.js';

export function createRequireAuth(database: Database, cookieName: string) {
  return async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const token = request.cookies[cookieName];

    if (!token) {
      await reply.code(401).send({ error: 'Authentication required.' });
      return;
    }

    const identity = await resolveSession(database, token);

    if (!identity) {
      reply.clearCookie(cookieName, { path: '/' });
      await reply.code(401).send({ error: 'Authentication required.' });
      return;
    }

    request.auth = identity;
  };
}
