import type { IncomingMessage, Server as HttpServer } from 'node:http';
import { and, eq, or } from 'drizzle-orm';
import { Server } from 'socket.io';
import { z } from 'zod';
import type { Database } from '@cubic/database';
import {
  blocks,
  conversationMembers,
  conversations,
  directConversationPairs
} from '@cubic/database/schema';
import { resolveSession, type SessionIdentity } from '../security/session.js';
import {
  CallLifecycleError,
  DirectCallCoordinator,
  type DirectCallSession,
  type TerminalDirectCallState
} from './calls.js';
import type { RealtimeEvents } from './events.js';

const joinSchema = z.object({ conversationId: z.string().uuid() });
const callStartSchema = z.object({ conversationId: z.string().uuid() });
const callIdSchema = z.object({ callId: z.string().uuid() });

const RING_TIMEOUT_MS = 45_000;

function conversationRoom(conversationId: string): string {
  return `conversation:${conversationId}`;
}

function userRoom(userId: string): string {
  return `user:${userId}`;
}

export function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;

  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    const key = part.slice(0, separator).trim();
    if (key !== name) continue;

    const value = part.slice(separator + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }

  return null;
}

export function isSameOriginRequest(request: IncomingMessage): boolean {
  const origin = request.headers.origin;
  if (!origin) return true;

  const forwardedHost = request.headers['x-forwarded-host'];
  const host = Array.isArray(forwardedHost)
    ? forwardedHost[0]
    : forwardedHost ?? request.headers.host;

  if (!host) return false;

  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export interface AttachRealtimeOptions {
  server: HttpServer;
  database: Database;
  cookieName: string;
  events: RealtimeEvents;
}

export interface RealtimeServer {
  close(): Promise<void>;
}

type CallWireState = 'ringing' | 'accepted' | TerminalDirectCallState;

interface CallWirePayload {
  id: string;
  conversationId: string;
  callerId: string;
  calleeId: string;
  callerDisplayName: string;
  callerUsername: string;
  state: CallWireState;
  createdAt: string;
  acceptedAt: string | null;
  actorId: string | null;
  joinSocketIds: string[];
}

type CallAck = {
  ok: boolean;
  call?: CallWirePayload | null;
  error?: string;
};

function toWireCall(
  call: DirectCallSession,
  state: CallWireState = call.state,
  actorId: string | null = null,
  joinSocketIds: string[] = []
): CallWirePayload {
  return {
    id: call.id,
    conversationId: call.conversationId,
    callerId: call.callerId,
    calleeId: call.calleeId,
    callerDisplayName: call.callerDisplayName,
    callerUsername: call.callerUsername,
    state,
    createdAt: call.createdAt.toISOString(),
    acceptedAt: call.acceptedAt?.toISOString() ?? null,
    actorId,
    joinSocketIds
  };
}

function callError(error: unknown): string {
  if (error instanceof CallLifecycleError) return error.message;
  return 'Call operation failed.';
}


async function persistCallStarted(database: Database, call: DirectCallSession): Promise<void> {
  const client = await database.pool.connect();
  try {
    await client.query('begin');
    await client.query(
      `insert into calls (
         id, conversation_id, kind, initiated_by, status, started_at
       ) values ($1, $2, 'direct', $3, 'ringing', $4)
       on conflict (id) do nothing`,
      [call.id, call.conversationId, call.callerId, call.createdAt]
    );
    await client.query(
      `insert into call_participants (call_id, user_id, role, invited_at)
       values ($1, $2, 'caller', $4), ($1, $3, 'callee', $4)
       on conflict (call_id, user_id) do nothing`,
      [call.id, call.callerId, call.calleeId, call.createdAt]
    );
    await client.query('commit');
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function persistCallAccepted(database: Database, call: DirectCallSession): Promise<void> {
  const acceptedAt = call.acceptedAt ?? new Date();
  const client = await database.pool.connect();
  try {
    await client.query('begin');
    await client.query(
      `update calls
          set status = 'accepted', answered_at = $2
        where id = $1`,
      [call.id, acceptedAt]
    );
    await client.query(
      `update call_participants
          set joined_at = coalesce(joined_at, $2)
        where call_id = $1`,
      [call.id, acceptedAt]
    );
    await client.query('commit');
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function persistCallFinished(
  database: Database,
  call: DirectCallSession,
  state: TerminalDirectCallState,
  actorId: string | null
): Promise<void> {
  const endedAt = new Date();
  const client = await database.pool.connect();
  try {
    await client.query('begin');
    await client.query(
      `update calls
          set status = $2,
              ended_at = $3,
              ended_by = $4
        where id = $1`,
      [call.id, state, endedAt, actorId]
    );
    await client.query(
      `update call_participants
          set left_at = case
            when joined_at is not null then coalesce(left_at, $2)
            else left_at
          end
        where call_id = $1`,
      [call.id, endedAt]
    );
    await client.query('commit');
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function recoverStaleCallRows(database: Database): Promise<void> {
  const endedAt = new Date();
  const client = await database.pool.connect();
  try {
    await client.query('begin');
    const stale = await client.query<{ id: string }>(
      `update calls
          set status = 'interrupted',
              ended_at = coalesce(ended_at, $1)
        where status in ('ringing', 'accepted')
          and ended_at is null
      returning id`,
      [endedAt]
    );

    if (stale.rowCount) {
      await client.query(
        `update call_participants
            set left_at = case
              when joined_at is not null then coalesce(left_at, $2)
              else left_at
            end
          where call_id = any($1::uuid[])`,
        [stale.rows.map((row) => row.id), endedAt]
      );
    }

    await client.query('commit');
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export function attachRealtime(options: AttachRealtimeOptions): RealtimeServer {
  const io = new Server(options.server, {
    path: '/socket.io',
    transports: ['websocket', 'polling'],
    maxHttpBufferSize: 64 * 1024,
    cors: {
      origin: true,
      credentials: true
    },
    allowRequest: (request, callback) => {
      const allowed = isSameOriginRequest(request);
      callback(allowed ? null : 'Origin not allowed.', allowed);
    }
  });

  const calls = new DirectCallCoordinator();
  const ringTimers = new Map<string, ReturnType<typeof setTimeout>>();
  void recoverStaleCallRows(options.database).catch(() => {});

  const clearRingTimer = (callId: string) => {
    const timer = ringTimers.get(callId);
    if (timer) clearTimeout(timer);
    ringTimers.delete(callId);
  };

  const emitCallState = (
    call: DirectCallSession,
    state: CallWireState = call.state,
    actorId: string | null = null,
    joinSocketIds: string[] = []
  ) => {
    const payload = toWireCall(call, state, actorId, joinSocketIds);
    io.to(userRoom(call.callerId)).emit('call:state', payload);
    io.to(userRoom(call.calleeId)).emit('call:state', payload);
  };

  const armRingTimeout = (call: DirectCallSession) => {
    clearRingTimer(call.id);
    const timer = setTimeout(() => {
      const finished = calls.expire(call.id);
      ringTimers.delete(call.id);
      if (finished) {
        void persistCallFinished(
          options.database,
          finished.call,
          finished.state,
          finished.actorId
        ).catch(() => {}).finally(() => {
          emitCallState(finished.call, finished.state, finished.actorId);
        });
      }
    }, RING_TIMEOUT_MS);
    timer.unref();
    ringTimers.set(call.id, timer);
  };

  io.use(async (socket, next) => {
    try {
      const token = readCookie(socket.request.headers.cookie, options.cookieName);
      if (!token) return next(new Error('Authentication required.'));

      const identity = await resolveSession(options.database, token);
      if (!identity) return next(new Error('Authentication required.'));

      (socket.data as { identity?: SessionIdentity }).identity = identity;
      next();
    } catch (error) {
      next(error instanceof Error ? error : new Error('Authentication failed.'));
    }
  });

  io.on('connection', async (socket) => {
    const identity = (socket.data as { identity?: SessionIdentity }).identity;
    if (!identity) {
      socket.disconnect(true);
      return;
    }

    socket.join(userRoom(identity.user.id));

    try {
      const memberships = await options.database.db
        .select({ conversationId: conversationMembers.conversationId })
        .from(conversationMembers)
        .where(eq(conversationMembers.userId, identity.user.id));

      for (const membership of memberships) {
        socket.join(conversationRoom(membership.conversationId));
      }

      socket.emit('realtime:ready', {
        userId: identity.user.id,
        conversationCount: memberships.length
      });
    } catch {
      socket.disconnect(true);
      return;
    }

    socket.on(
      'conversation:join',
      async (
        payload: unknown,
        acknowledge?: (result: { ok: boolean; error?: string }) => void
      ) => {
        const parsed = joinSchema.safeParse(payload);
        if (!parsed.success) {
          acknowledge?.({ ok: false, error: 'Invalid conversation.' });
          return;
        }

        const membership = await options.database.db
          .select({ conversationId: conversationMembers.conversationId })
          .from(conversationMembers)
          .where(
            and(
              eq(conversationMembers.conversationId, parsed.data.conversationId),
              eq(conversationMembers.userId, identity.user.id)
            )
          )
          .limit(1);

        if (!membership[0]) {
          acknowledge?.({ ok: false, error: 'Conversation not found.' });
          return;
        }

        await socket.join(conversationRoom(parsed.data.conversationId));
        acknowledge?.({ ok: true });
      }
    );

    socket.on('call:sync', (_payload: unknown, acknowledge?: (result: CallAck) => void) => {
      const current = calls.getForUser(identity.user.id);
      acknowledge?.({ ok: true, call: current ? toWireCall(current) : null });
    });

    socket.on(
      'call:start',
      async (payload: unknown, acknowledge?: (result: CallAck) => void) => {
        const parsed = callStartSchema.safeParse(payload);
        if (!parsed.success) {
          acknowledge?.({ ok: false, error: 'Invalid conversation.' });
          return;
        }

        try {
          const rows = await options.database.db
            .select({
              kind: conversations.kind,
              userLowId: directConversationPairs.userLowId,
              userHighId: directConversationPairs.userHighId
            })
            .from(conversations)
            .innerJoin(
              directConversationPairs,
              eq(directConversationPairs.conversationId, conversations.id)
            )
            .where(eq(conversations.id, parsed.data.conversationId))
            .limit(1);

          const direct = rows[0];
          if (!direct || direct.kind !== 'direct') {
            acknowledge?.({ ok: false, error: 'Direct conversation not found.' });
            return;
          }

          if (direct.userLowId !== identity.user.id && direct.userHighId !== identity.user.id) {
            acknowledge?.({ ok: false, error: 'Direct conversation not found.' });
            return;
          }

          const calleeId =
            direct.userLowId === identity.user.id ? direct.userHighId : direct.userLowId;

          const blockRows = await options.database.db
            .select({ id: blocks.id })
            .from(blocks)
            .where(
              or(
                and(eq(blocks.blockerId, identity.user.id), eq(blocks.blockedId, calleeId)),
                and(eq(blocks.blockerId, calleeId), eq(blocks.blockedId, identity.user.id))
              )
            )
            .limit(1);

          if (blockRows.length > 0) {
            acknowledge?.({ ok: false, error: 'Voice is unavailable for this conversation.' });
            return;
          }

          const call = calls.start({
            conversationId: parsed.data.conversationId,
            callerId: identity.user.id,
            calleeId,
            callerDisplayName: identity.user.displayName,
            callerUsername: identity.user.username,
            callerSocketId: socket.id
          });

          try {
            await persistCallStarted(options.database, call);
          } catch (error) {
            try {
              calls.cancel(call.id, identity.user.id);
            } catch {}
            throw error;
          }

          armRingTimeout(call);
          const wire = toWireCall(call);
          acknowledge?.({ ok: true, call: wire });
          io.to(userRoom(call.callerId)).emit('call:state', wire);
          io.to(userRoom(call.calleeId)).emit('call:incoming', wire);
        } catch (error) {
          acknowledge?.({ ok: false, error: callError(error) });
        }
      }
    );

    socket.on(
      'call:accept',
      async (payload: unknown, acknowledge?: (result: CallAck) => void) => {
        const parsed = callIdSchema.safeParse(payload);
        if (!parsed.success) {
          acknowledge?.({ ok: false, error: 'Invalid call.' });
          return;
        }

        try {
          const call = calls.accept(parsed.data.callId, identity.user.id, socket.id);
          await persistCallAccepted(options.database, call);
          clearRingTimer(call.id);
          const joinSocketIds = [call.callerSocketId, socket.id];
          const wire = toWireCall(call, 'accepted', identity.user.id, joinSocketIds);
          acknowledge?.({ ok: true, call: wire });
          emitCallState(call, 'accepted', identity.user.id, joinSocketIds);
        } catch (error) {
          acknowledge?.({ ok: false, error: callError(error) });
        }
      }
    );

    socket.on(
      'call:decline',
      async (payload: unknown, acknowledge?: (result: CallAck) => void) => {
        const parsed = callIdSchema.safeParse(payload);
        if (!parsed.success) {
          acknowledge?.({ ok: false, error: 'Invalid call.' });
          return;
        }

        try {
          const finished = calls.decline(parsed.data.callId, identity.user.id);
          await persistCallFinished(
            options.database,
            finished.call,
            finished.state,
            finished.actorId
          );
          clearRingTimer(finished.call.id);
          const wire = toWireCall(finished.call, finished.state, finished.actorId);
          acknowledge?.({ ok: true, call: wire });
          emitCallState(finished.call, finished.state, finished.actorId);
        } catch (error) {
          acknowledge?.({ ok: false, error: callError(error) });
        }
      }
    );

    socket.on(
      'call:cancel',
      async (payload: unknown, acknowledge?: (result: CallAck) => void) => {
        const parsed = callIdSchema.safeParse(payload);
        if (!parsed.success) {
          acknowledge?.({ ok: false, error: 'Invalid call.' });
          return;
        }

        try {
          const finished = calls.cancel(parsed.data.callId, identity.user.id);
          await persistCallFinished(
            options.database,
            finished.call,
            finished.state,
            finished.actorId
          );
          clearRingTimer(finished.call.id);
          const wire = toWireCall(finished.call, finished.state, finished.actorId);
          acknowledge?.({ ok: true, call: wire });
          emitCallState(finished.call, finished.state, finished.actorId);
        } catch (error) {
          acknowledge?.({ ok: false, error: callError(error) });
        }
      }
    );

    socket.on(
      'call:end',
      async (payload: unknown, acknowledge?: (result: CallAck) => void) => {
        const parsed = callIdSchema.safeParse(payload);
        if (!parsed.success) {
          acknowledge?.({ ok: false, error: 'Invalid call.' });
          return;
        }

        try {
          const finished = calls.end(parsed.data.callId, identity.user.id);
          await persistCallFinished(
            options.database,
            finished.call,
            finished.state,
            finished.actorId
          );
          clearRingTimer(finished.call.id);
          const wire = toWireCall(finished.call, finished.state, finished.actorId);
          acknowledge?.({ ok: true, call: wire });
          emitCallState(finished.call, finished.state, finished.actorId);
        } catch (error) {
          acknowledge?.({ ok: false, error: callError(error) });
        }
      }
    );
  });

  const unsubscribeMessage = options.events.onMessageCreated((event) => {
    io.to(conversationRoom(event.conversationId)).emit('message:created', event.message);
  });

  const unsubscribeOpened = options.events.onConversationOpened((event) => {
    for (const userId of event.userIds) {
      const room = userRoom(userId);
      io.in(room).socketsJoin(conversationRoom(event.conversationId));
      io.to(room).emit('conversation:updated', { conversationId: event.conversationId });
    }
  });

  const unsubscribeChanged = options.events.onConversationChanged((event) => {
    for (const userId of event.userIds) {
      io.to(userRoom(userId)).emit('conversation:updated', { conversationId: event.conversationId });
    }
  });

  const unsubscribeRemoved = options.events.onConversationRemoved((event) => {
    for (const userId of event.removedUserIds) {
      const room = userRoom(userId);
      io.in(room).socketsLeave(conversationRoom(event.conversationId));
      io.to(room).emit('conversation:removed', { conversationId: event.conversationId });
    }

    for (const userId of event.remainingUserIds) {
      io.to(userRoom(userId)).emit('conversation:updated', { conversationId: event.conversationId });
    }
  });

  const unsubscribeInvites = options.events.onGroupInvitesChanged((event) => {
    for (const userId of event.userIds) {
      io.to(userRoom(userId)).emit('group:invites:updated');
    }
  });

  return {
    async close() {
      for (const timer of ringTimers.values()) clearTimeout(timer);
      ringTimers.clear();
      unsubscribeMessage();
      unsubscribeOpened();
      unsubscribeChanged();
      unsubscribeRemoved();
      unsubscribeInvites();
      io.disconnectSockets(true);
      await new Promise<void>((resolve) => io.close(() => resolve()));
    }
  };
}
