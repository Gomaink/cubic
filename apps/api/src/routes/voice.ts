import { and, eq, or } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Database } from '@cubic/database';
import {
  blocks,
  conversationMembers,
  conversations,
  directConversationPairs
} from '@cubic/database/schema';
import { createRequireAuth } from '../auth/guard.js';
import { createVoiceJoinToken } from '../voice/token.js';

export interface VoiceRoutesOptions {
  database: Database;
  cookieName: string;
  livekitPublicUrl: string;
  livekitApiKey: string;
  livekitApiSecret: string;
}

const conversationParams = z.object({
  conversationId: z.string().uuid()
});

export async function voiceRoutes(
  app: FastifyInstance,
  options: VoiceRoutesOptions
): Promise<void> {
  const requireAuth = createRequireAuth(options.database, options.cookieName);

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
      const userId = request.auth.user.id;

      const memberships = await options.database.db
        .select({
          conversationId: conversationMembers.conversationId,
          kind: conversations.kind
        })
        .from(conversationMembers)
        .innerJoin(conversations, eq(conversationMembers.conversationId, conversations.id))
        .where(
          and(
            eq(conversationMembers.conversationId, conversationId),
            eq(conversationMembers.userId, userId)
          )
        )
        .limit(1);

      const membership = memberships[0];
      if (!membership) {
        return reply.code(403).send({ error: 'You are not a member of this conversation.' });
      }

      if (membership.kind === 'direct') {
        const pairs = await options.database.db
          .select({
            userLowId: directConversationPairs.userLowId,
            userHighId: directConversationPairs.userHighId
          })
          .from(directConversationPairs)
          .where(eq(directConversationPairs.conversationId, conversationId))
          .limit(1);

        const pair = pairs[0];
        if (!pair) {
          return reply.code(409).send({ error: 'Direct conversation pair is missing.' });
        }

        const peerId = pair.userLowId === userId ? pair.userHighId : pair.userLowId;
        const blockRows = await options.database.db
          .select({ id: blocks.id })
          .from(blocks)
          .where(
            or(
              and(eq(blocks.blockerId, userId), eq(blocks.blockedId, peerId)),
              and(eq(blocks.blockerId, peerId), eq(blocks.blockedId, userId))
            )
          )
          .limit(1);

        if (blockRows.length > 0) {
          return reply.code(403).send({ error: 'Voice is unavailable for this conversation.' });
        }
      }

      const ticket = await createVoiceJoinToken({
        apiKey: options.livekitApiKey,
        apiSecret: options.livekitApiSecret,
        publicUrl: options.livekitPublicUrl,
        conversationId,
        userId,
        displayName: request.auth.user.displayName
      });

      return reply.send(ticket);
    }
  );
}
