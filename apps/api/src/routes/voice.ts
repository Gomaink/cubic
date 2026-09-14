import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createRequireAuth } from '../auth/guard.js';
import type { SessionService } from '../security/session.js';
import {
  LiveKitControlPlaneUnavailableError,
  VoiceAuthorizationDeniedError,
  type LiveKitAuthorizationService
} from '../voice/authorization.js';

export interface VoiceRoutesOptions {
  cookieName: string;
  sessionService: SessionService;
  livekitAuthorization: LiveKitAuthorizationService;
}

const conversationParams = z.object({
  conversationId: z.string().uuid()
});

export async function voiceRoutes(
  app: FastifyInstance,
  options: VoiceRoutesOptions
): Promise<void> {
  const requireAuth = createRequireAuth(options.sessionService, options.cookieName);

  app.post(
    '/conversations/:conversationId/token',
    { preHandler: requireAuth },
    async (request, reply) => {
      if (!request.auth) return;

      const parsed = conversationParams.safeParse(request.params);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Invalid conversation id.' });
      }

      const { conversationId } = parsed.data;
      try {
        const ticket = await options.livekitAuthorization.issueJoinTicket({
          sessionId: request.auth.sessionId,
          userId: request.auth.user.id,
          displayName: request.auth.user.displayName,
          conversationId
        });
        return reply.send(ticket);
      } catch (error) {
        if (error instanceof LiveKitControlPlaneUnavailableError) {
          return reply.code(503).send({ error: 'Voice service is temporarily unavailable.' });
        }
        if (error instanceof VoiceAuthorizationDeniedError) {
          return reply.code(403).send({ error: 'Voice is unavailable.' });
        }
        throw error;
      }
    }
  );
}
