import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Database } from '@cubic/database';
import { createRequireAuth } from '../auth/guard.js';

export interface CallHistoryRoutesOptions {
  database: Database;
  cookieName: string;
}

const historyQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  before: z.string().datetime({ offset: true }).optional()
});

export function callDurationSeconds(answeredAt: Date | null, endedAt: Date | null): number | null {
  if (!answeredAt || !endedAt) return null;
  return Math.max(0, Math.floor((endedAt.getTime() - answeredAt.getTime()) / 1000));
}

export async function callHistoryRoutes(
  app: FastifyInstance,
  options: CallHistoryRoutesOptions
): Promise<void> {
  const requireAuth = createRequireAuth(options.database, options.cookieName);

  app.get('/', { preHandler: requireAuth }, async (request, reply) => {
    if (!request.auth) return;

    const parsed = historyQuery.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid call history query.' });
    }

    const before = parsed.data.before ? new Date(parsed.data.before) : null;
    const result = await options.database.pool.query(
      `select
         call.id,
         call.conversation_id,
         call.kind,
         call.initiated_by,
         call.status,
         call.started_at,
         call.answered_at,
         call.ended_at,
         call.ended_by,
         conv.title as conversation_title,
         conv.kind as conversation_kind,
         peer.id as peer_id,
         peer.username as peer_username,
         peer.display_name as peer_display_name,
         peer.avatar_url as peer_avatar_url
       from calls call
       join conversations conv on conv.id = call.conversation_id
       join conversation_members mine
         on mine.conversation_id = call.conversation_id
        and mine.user_id = $1
       left join direct_conversation_pairs dp on dp.conversation_id = call.conversation_id
       left join users peer on peer.id = case
         when dp.user_low_id = $1 then dp.user_high_id
         else dp.user_low_id
       end
       where ($2::timestamptz is null or call.started_at < $2)
       order by call.started_at desc, call.id desc
       limit $3`,
      [request.auth.user.id, before, parsed.data.limit + 1]
    );

    const hasMore = result.rows.length > parsed.data.limit;
    const rows = result.rows.slice(0, parsed.data.limit);

    return reply.send({
      calls: rows.map((row) => {
        const answeredAt = row.answered_at ? new Date(row.answered_at) : null;
        const endedAt = row.ended_at ? new Date(row.ended_at) : null;

        return {
          id: row.id,
          conversationId: row.conversation_id,
          kind: row.kind,
          direction: row.initiated_by === request.auth!.user.id ? 'outgoing' : 'incoming',
          status: row.status,
          startedAt: new Date(row.started_at).toISOString(),
          answeredAt: answeredAt?.toISOString() ?? null,
          endedAt: endedAt?.toISOString() ?? null,
          durationSeconds: callDurationSeconds(answeredAt, endedAt),
          conversation: {
            kind: row.conversation_kind,
            title: row.conversation_title,
            peer: row.peer_id
              ? {
                  id: row.peer_id,
                  username: row.peer_username,
                  displayName: row.peer_display_name,
                  avatarUrl: row.peer_avatar_url
                }
              : null
          }
        };
      }),
      nextCursor: hasMore && rows.length
        ? new Date(rows[rows.length - 1].started_at).toISOString()
        : null
    });
  });
}
