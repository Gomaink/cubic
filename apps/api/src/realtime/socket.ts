import type { IncomingMessage, Server as HttpServer } from 'node:http';
import { and, eq, inArray } from 'drizzle-orm';
import { Server, type Socket } from 'socket.io';
import { z } from 'zod';
import type { Database } from '@cubic/database';
import { conversationMembers, conversations } from '@cubic/database/schema';
import {
  authorizeDirectCallStart,
  resolveConversationAccess,
  resolveConversationMembership
} from '../authorization/conversations.js';
import type { SessionIdentity, SessionService } from '../security/session.js';
import { createTrustedProxyCheck } from '../config/proxy.js';
import { SessionSocketRegistry } from './session-sockets.js';
import {
  CallLifecycleError,
  DirectCallCoordinator,
  type DirectCallSession,
  type TerminalDirectCallState
} from './calls.js';
import type { RealtimeEvents, ProfileChangedEvent } from './events.js';
import { browserOriginMatches, canonicalBrowserOrigin } from '../security/browser-request.js';
import { PresenceRegistry, type PresenceStatus } from './presence.js';

const joinSchema = z.object({ conversationId: z.string().uuid() });
const callStartSchema = z.object({ conversationId: z.string().uuid() });
const callIdSchema = z.object({ callId: z.string().uuid() });
const presenceActivitySchema = z.object({ state: z.enum(['active', 'idle']) }).strict();

const RING_TIMEOUT_MS = 45_000;
const MAX_PENDING_ADMISSIONS_PER_SOCKET = 8;
const MAX_PENDING_CALL_STARTS_PER_SOCKET = 8;
const MAX_REMOVALS_PER_ADMISSION = 64;

function conversationRoom(conversationId: string): string {
  return `conversation:${conversationId}`;
}

function userRoom(userId: string): string {
  return `user:${userId}`;
}

function acknowledgePacketFailure(packet: unknown[], error: string): void {
  const acknowledge = packet.at(-1);
  if (typeof acknowledge === 'function') acknowledge({ ok: false, error });
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

export function isSameOriginRequest(
  request: IncomingMessage,
  isTrustedProxy: (address: string) => boolean,
  expectedOrigin?: string
): boolean {
  const origin = request.headers.origin;
  if (!origin) return true;

  const forwardedHost = request.headers['x-forwarded-host'];
  const remoteAddress = request.socket.remoteAddress ?? '';
  const host = isTrustedProxy(remoteAddress)
    ? Array.isArray(forwardedHost)
      ? forwardedHost[0]
      : forwardedHost ?? request.headers.host
    : request.headers.host;

  const forwardedProto = request.headers['x-forwarded-proto'];
  const protocol = isTrustedProxy(remoteAddress)
    ? Array.isArray(forwardedProto)
      ? forwardedProto[0]
      : forwardedProto
    : (request.socket as typeof request.socket & { encrypted?: boolean }).encrypted
      ? 'https'
      : 'http';

  if (!host || (protocol !== 'http' && protocol !== 'https')) return false;

  try {
    const requestOrigin = canonicalBrowserOrigin(`${protocol}://${host}`);
    return browserOriginMatches(origin, expectedOrigin ?? requestOrigin) &&
      (!expectedOrigin || requestOrigin === expectedOrigin);
  } catch {
    return false;
  }
}

export interface AttachRealtimeOptions {
  server: HttpServer;
  database: Database;
  cookieName: string;
  sessionService: SessionService;
  revalidateIntervalMs: number;
  trustedProxyCidrs: string[];
  browserOrigin: string;
  events: RealtimeEvents;
  pingIntervalMs?: number;
  pingTimeoutMs?: number;
}

export interface RealtimeServer {
  registry: SessionSocketRegistry;
  readonly pendingAdmissionCount: number;
  revalidateSessions(): Promise<void>;
  close(): Promise<void>;
}

export interface SocketSessionIdentity {
  sessionId: string;
  userId: string;
  username: string;
  displayName: string;
}

export function toSocketSessionIdentity(identity: SessionIdentity): SocketSessionIdentity {
  return {
    sessionId: identity.sessionId,
    userId: identity.user.id,
    username: identity.user.username,
    displayName: identity.user.displayName
  };
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
  if (!Number.isSafeInteger(options.revalidateIntervalMs) || options.revalidateIntervalMs <= 0) {
    throw new Error('Socket session revalidation interval must be a positive integer.');
  }

  const isTrustedProxy = createTrustedProxyCheck(options.trustedProxyCidrs);
  const io = new Server(options.server, {
    path: '/socket.io',
    transports: ['websocket', 'polling'],
    maxHttpBufferSize: 64 * 1024,
    ...(options.pingIntervalMs === undefined ? {} : { pingInterval: options.pingIntervalMs }),
    ...(options.pingTimeoutMs === undefined ? {} : { pingTimeout: options.pingTimeoutMs }),
    cors: {
      origin: options.browserOrigin,
      credentials: true
    },
    allowRequest: (request, callback) => {
      const allowed = isSameOriginRequest(request, isTrustedProxy, options.browserOrigin);
      callback(allowed ? null : 'Origin not allowed.', allowed);
    }
  });

  const calls = new DirectCallCoordinator();
  const ringTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const registry = new SessionSocketRegistry();
  type PresenceFanout = {
    version: number;
    status: PresenceStatus;
    activeRead: { removedConversations: Set<string> } | null;
  };
  const presenceFanouts = new Map<string, PresenceFanout>();
  const profileFanouts = new Map<string, { version: number; event: ProfileChangedEvent }>();
  const presence = new PresenceRegistry((userId, status) => {
    let fanout = presenceFanouts.get(userId);
    if (fanout) {
      fanout.version += 1;
      fanout.status = status;
      return;
    }
    fanout = { version: 1, status, activeRead: null };
    presenceFanouts.set(userId, fanout);
    const ownedFanout = fanout;
    void (async () => {
      try {
        while (true) {
          const version = ownedFanout.version;
          const currentStatus = ownedFanout.status;
          const read = { removedConversations: new Set<string>() };
          ownedFanout.activeRead = read;
          try {
            const memberships = await options.database.pool.query<{ conversation_id: string }>(
              'select conversation_id from conversation_members where user_id = $1',
              [userId]
            );
            if (version === ownedFanout.version && presence.status(userId) === currentStatus) {
              for (const { conversation_id: conversationId } of memberships.rows) {
                if (!read.removedConversations.has(conversationId)) {
                  io.to(conversationRoom(conversationId)).emit('presence:changed', {
                    userId,
                    status: currentStatus
                  });
                }
              }
            }
          } catch {
            // Database uncertainty cannot authorize presence disclosure.
          } finally {
            ownedFanout.activeRead = null;
          }
          if (version === ownedFanout.version) break;
        }
      } finally {
        if (presenceFanouts.get(userId) === ownedFanout) presenceFanouts.delete(userId);
      }
    })();
  });
  // Track only in-flight admissions. A removal permanently invalidates work
  // started before it; a later admission reads current membership from the DB.
  type Admission = {
    removedConversations: Set<string>;
    cancelled: boolean;
    finish(): void;
    invalidFor(conversationId: string): boolean;
  };
  const admissionsByUser = new Map<string, Set<Admission>>();
  const admissionsBySocket = new Map<string, Set<Admission>>();
  type PendingCallStart = {
    conversationId: string;
    invalidated: boolean;
    call: DirectCallSession | null;
    finished: ReturnType<DirectCallCoordinator['cancel']> | null;
    finish(): void;
  };
  const pendingCallStartsBySocket = new Map<string, Set<PendingCallStart>>();
  const pendingCallStartsByConversation = new Map<string, Set<PendingCallStart>>();
  const beginCallStart = (socket: Socket, conversationId: string): PendingCallStart | null => {
    if (!socket.connected) return null;
    let bySocket = pendingCallStartsBySocket.get(socket.id);
    if (bySocket && bySocket.size >= MAX_PENDING_CALL_STARTS_PER_SOCKET) return null;
    if (!bySocket) pendingCallStartsBySocket.set(socket.id, bySocket = new Set());
    let byConversation = pendingCallStartsByConversation.get(conversationId);
    if (!byConversation) pendingCallStartsByConversation.set(conversationId, byConversation = new Set());
    const socketSet = bySocket;
    const conversationSet = byConversation;
    const pending: PendingCallStart = {
      conversationId,
      invalidated: false,
      call: null,
      finished: null,
      finish: () => {
        socketSet.delete(pending);
        conversationSet.delete(pending);
        if (socketSet.size === 0 && pendingCallStartsBySocket.get(socket.id) === socketSet)
          pendingCallStartsBySocket.delete(socket.id);
        if (conversationSet.size === 0 && pendingCallStartsByConversation.get(conversationId) === conversationSet)
          pendingCallStartsByConversation.delete(conversationId);
      }
    };
    socketSet.add(pending);
    conversationSet.add(pending);
    return pending;
  };
  const invalidateCallStart = (pending: PendingCallStart, blockerId?: string) => {
    pending.invalidated = true;
    if (!pending.call || pending.finished) return;
    const call = calls.get(pending.call.id);
    if (!call) return;
    pending.finished = blockerId
      ? calls.terminateForBlock(call.conversationId, blockerId)
      : call.state === 'ringing'
        ? calls.cancel(call.id, call.callerId)
        : calls.end(call.id, call.callerId);
    if (pending.finished) clearRingTimer(pending.finished.call.id);
  };
  const retireSocketCallStarts = (socketId: string) => {
    for (const pending of [...(pendingCallStartsBySocket.get(socketId) ?? [])]) {
      invalidateCallStart(pending);
      pending.finish();
    }
  };
  const beginAdmission = (socket: Socket, userId: string): Admission | null => {
    if (!socket.connected) return null;
    let socketAdmissions = admissionsBySocket.get(socket.id);
    if (socketAdmissions && socketAdmissions.size >= MAX_PENDING_ADMISSIONS_PER_SOCKET) return null;
    if (!socketAdmissions) {
      socketAdmissions = new Set();
      admissionsBySocket.set(socket.id, socketAdmissions);
    }
    let userAdmissions = admissionsByUser.get(userId);
    if (!userAdmissions) {
      userAdmissions = new Set();
      admissionsByUser.set(userId, userAdmissions);
    }
    const ownedSocketAdmissions = socketAdmissions;
    const ownedUserAdmissions = userAdmissions;
    const admission: Admission = {
      removedConversations: new Set(),
      cancelled: false,
      invalidFor: (conversationId) =>
        admission.cancelled || !socket.connected || admission.removedConversations.has(conversationId),
      finish: () => {
        ownedSocketAdmissions.delete(admission);
        ownedUserAdmissions.delete(admission);
        if (ownedSocketAdmissions.size === 0 && admissionsBySocket.get(socket.id) === ownedSocketAdmissions)
          admissionsBySocket.delete(socket.id);
        if (ownedUserAdmissions.size === 0 && admissionsByUser.get(userId) === ownedUserAdmissions)
          admissionsByUser.delete(userId);
      }
    };
    socketAdmissions.add(admission);
    userAdmissions.add(admission);
    return admission;
  };
  const retireSocketAdmissions = (socketId: string) => {
    for (const admission of [...(admissionsBySocket.get(socketId) ?? [])]) {
      admission.cancelled = true;
      admission.finish();
    }
  };
  let activeRevalidation: Promise<void> | null = null;
  void recoverStaleCallRows(options.database).catch(() => {});

  const revalidateActiveSessions = (): Promise<void> => {
    if (activeRevalidation) return activeRevalidation;
    const run = (async () => {
      for (const sessionId of registry.sessionIds()) {
        try {
          const identity = await options.sessionService.validateId(sessionId, { activity: false });
          if (!identity) {
            options.events.emitSessionRevoked({ sessionId });
            registry.disconnectSession(sessionId);
          }
        } catch {
          // Database uncertainty is not proof of revocation. Retry on the next sweep.
        }
      }
    })();
    activeRevalidation = run;
    const clear = () => {
      if (activeRevalidation === run) activeRevalidation = null;
    };
    void run.then(clear, clear);
    return run;
  };

  const revalidationTimer = setInterval(
    () => void revalidateActiveSessions(),
    options.revalidateIntervalMs
  );
  revalidationTimer.unref();

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
        ).then(() => {
          options.events.emitCallAuthorizationEnded({
            callId: finished.call.id,
            conversationId: finished.call.conversationId
          });
        }).catch(() => {}).finally(() => {
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

      const identity = await options.sessionService.resolveToken(token, { activity: false });
      if (!identity) return next(new Error('Authentication required.'));

      (socket.data as { identity?: SocketSessionIdentity }).identity =
        toSocketSessionIdentity(identity);
      next();
    } catch {
      next(new Error('Authentication failed.'));
    }
  });

  io.on('connection', async (socket) => {
    const identity = (socket.data as { identity?: SocketSessionIdentity }).identity;
    if (!identity) {
      socket.disconnect(true);
      return;
    }

    registry.register(identity.sessionId, socket);
    socket.once('disconnect', () => {
      retireSocketAdmissions(socket.id);
      retireSocketCallStarts(socket.id);
      presence.unregister(socket.id);
    });

    try {
      const current = await options.sessionService.validateId(identity.sessionId, { activity: false });
      if (!current) {
        options.events.emitSessionRevoked({ sessionId: identity.sessionId });
        registry.disconnectSession(identity.sessionId);
        return;
      }
      Object.assign(identity, toSocketSessionIdentity(current));
    } catch {
      socket.disconnect(true);
      return;
    }

    if (!socket.connected) return;

    socket.use(async (packet, next) => {
      try {
        const current = await options.sessionService.validateId(identity.sessionId, { activity: true });
        if (!current) {
          acknowledgePacketFailure(packet, 'Authentication required.');
          options.events.emitSessionRevoked({ sessionId: identity.sessionId });
          registry.disconnectSession(identity.sessionId);
          return next(new Error('Authentication required.'));
        }
        Object.assign(identity, toSocketSessionIdentity(current));
        next();
      } catch {
        acknowledgePacketFailure(packet, 'Session validation is temporarily unavailable.');
        next(new Error('Session validation is temporarily unavailable.'));
      }
    });

    socket.join(userRoom(identity.userId));
    presence.register(identity.userId, socket.id);

    const initialAdmission = beginAdmission(socket, identity.userId);
    if (!initialAdmission) {
      socket.disconnect(true);
      return;
    }
    try {
      const memberships = await options.database.db
        .select({ conversationId: conversationMembers.conversationId })
        .from(conversationMembers)
        .innerJoin(conversations, eq(conversations.id, conversationMembers.conversationId))
        .where(and(
          eq(conversationMembers.userId, identity.userId),
          inArray(conversations.kind, ['direct', 'group'])
        ));
      const channels = await options.database.pool.query<{ conversation_id: string }>(
        `select channel.conversation_id
           from server_members member
           join server_text_channels channel on channel.server_id = member.server_id
           join conversations c on c.id = channel.conversation_id and c.kind = 'server_text'
          where member.user_id = $1`,
        [identity.userId]
      );

      const conversationIds = new Set([
        ...memberships.map((membership) => membership.conversationId),
        ...channels.rows.map((channel) => channel.conversation_id)
      ]);
      for (const conversationId of conversationIds) {
        if (initialAdmission.invalidFor(conversationId)) continue;
        // The configured single-process in-memory adapter joins synchronously.
        socket.join(conversationRoom(conversationId));
        if (initialAdmission.invalidFor(conversationId))
          socket.leave(conversationRoom(conversationId));
      }

      if (!socket.connected) return;
      socket.emit('realtime:ready', {
        userId: identity.userId,
        conversationCount: conversationIds.size
      });
    } catch {
      socket.disconnect(true);
      return;
    } finally {
      initialAdmission.finish();
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

        const admission = beginAdmission(socket, identity.userId);
        if (!admission) {
          acknowledge?.({ ok: false, error: 'Realtime is busy. Try again.' });
          return;
        }
        try {
          const membership = await resolveConversationAccess(
            options.database,
            parsed.data.conversationId,
            identity.userId
          );

          if (!membership || admission.invalidFor(parsed.data.conversationId)) {
            if (!socket.connected) return;
            acknowledge?.({ ok: false, error: 'Conversation not found.' });
            return;
          }

          socket.join(conversationRoom(parsed.data.conversationId));
          if (admission.invalidFor(parsed.data.conversationId)) {
            socket.leave(conversationRoom(parsed.data.conversationId));
            if (!socket.connected) return;
            acknowledge?.({ ok: false, error: 'Conversation not found.' });
            return;
          }
          acknowledge?.({ ok: true });
        } finally {
          admission.finish();
        }
      }
    );

    socket.on('presence:set', (payload: unknown, acknowledge?: (result: { ok: boolean }) => void) => {
      const parsed = presenceActivitySchema.safeParse(payload);
      acknowledge?.({ ok: parsed.success && presence.setActivity(socket.id, parsed.data.state) });
    });

    socket.on('presence:snapshot', async (
      payload: unknown,
      acknowledge?: (result: { ok: boolean; statuses?: Record<string, PresenceStatus> }) => void
    ) => {
      const parsed = joinSchema.safeParse(payload);
      if (!parsed.success) return acknowledge?.({ ok: false });
      const admission = beginAdmission(socket, identity.userId);
      if (!admission) return acknowledge?.({ ok: false });
      try {
        const members = await options.database.pool.query<{ user_id: string }>(
          'select user_id from conversation_members where conversation_id = $1',
          [parsed.data.conversationId]
        );
        if (!members.rows.some((member) => member.user_id === identity.userId) ||
            admission.invalidFor(parsed.data.conversationId)) {
          if (socket.connected) acknowledge?.({ ok: false });
          return;
        }
        const statuses = Object.fromEntries(
          members.rows.map((member) => [member.user_id, presence.status(member.user_id)])
        );
        acknowledge?.({ ok: true, statuses });
      } catch {
        if (socket.connected) acknowledge?.({ ok: false });
      } finally {
        admission.finish();
      }
    });

    socket.on('call:sync', (_payload: unknown, acknowledge?: (result: CallAck) => void) => {
      const current = calls.getForUser(identity.userId);
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

        const pending = beginCallStart(socket, parsed.data.conversationId);
        if (!pending) {
          acknowledge?.({ ok: false, error: 'Call operation failed.' });
          return;
        }
        try {
          const direct = await authorizeDirectCallStart(
            options.database,
            parsed.data.conversationId,
            identity.userId
          );
          if (pending.invalidated || !socket.connected) {
            if (socket.connected) acknowledge?.({ ok: false, error: 'Call operation failed.' });
            return;
          }
          if (!direct.allowed && direct.reason === 'not_found') {
            acknowledge?.({ ok: false, error: 'Direct conversation not found.' });
            return;
          }
          if (!direct.allowed) {
            acknowledge?.({ ok: false, error: 'Voice is unavailable for this conversation.' });
            return;
          }

          const calleeId = direct.peerUserId;

          const existingCall = calls.getForConversation(parsed.data.conversationId);
          // Do not let a second socket reuse a call whose creator has not yet
          // committed its start. The creator may still disconnect or be blocked.
          if (existingCall && [...(pendingCallStartsByConversation.get(parsed.data.conversationId) ?? [])]
            .some((start) => start !== pending && start.call?.id === existingCall.id)) {
            acknowledge?.({ ok: false, error: 'Call operation failed.' });
            return;
          }
          const call = calls.start({
            conversationId: parsed.data.conversationId,
            callerId: identity.userId,
            calleeId,
            callerDisplayName: identity.displayName,
            callerUsername: identity.username,
            callerSocketId: socket.id
          });
          if (!existingCall) pending.call = call;

          try {
            await persistCallStarted(options.database, call);
          } catch (error) {
            if (pending.call) invalidateCallStart(pending);
            throw error;
          }

          if (pending.invalidated || !socket.connected || calls.get(call.id) !== call) {
            if (pending.finished) {
              await persistCallFinished(
                options.database,
                pending.finished.call,
                pending.finished.state,
                pending.finished.actorId
              );
            }
            if (socket.connected) acknowledge?.({ ok: false, error: 'Call operation failed.' });
            return;
          }

          armRingTimeout(call);
          const wire = toWireCall(call);
          acknowledge?.({ ok: true, call: wire });
          io.to(userRoom(call.callerId)).emit('call:state', wire);
          io.to(userRoom(call.calleeId)).emit('call:incoming', wire);
        } catch (error) {
          if (socket.connected) acknowledge?.({ ok: false, error: callError(error) });
        } finally {
          pending.finish();
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
          const call = calls.accept(parsed.data.callId, identity.userId, socket.id);
          await persistCallAccepted(options.database, call);
          clearRingTimer(call.id);
          const joinSocketIds = [call.callerSocketId, socket.id];
          const wire = toWireCall(call, 'accepted', identity.userId, joinSocketIds);
          acknowledge?.({ ok: true, call: wire });
          emitCallState(call, 'accepted', identity.userId, joinSocketIds);
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
          const finished = calls.decline(parsed.data.callId, identity.userId);
          await persistCallFinished(
            options.database,
            finished.call,
            finished.state,
            finished.actorId
          );
          clearRingTimer(finished.call.id);
          options.events.emitCallAuthorizationEnded({
            callId: finished.call.id,
            conversationId: finished.call.conversationId
          });
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
          const finished = calls.cancel(parsed.data.callId, identity.userId);
          await persistCallFinished(
            options.database,
            finished.call,
            finished.state,
            finished.actorId
          );
          clearRingTimer(finished.call.id);
          options.events.emitCallAuthorizationEnded({
            callId: finished.call.id,
            conversationId: finished.call.conversationId
          });
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
          const finished = calls.end(parsed.data.callId, identity.userId);
          await persistCallFinished(
            options.database,
            finished.call,
            finished.state,
            finished.actorId
          );
          clearRingTimer(finished.call.id);
          options.events.emitCallAuthorizationEnded({
            callId: finished.call.id,
            conversationId: finished.call.conversationId
          });
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

  const unsubscribeMessageUpdated = options.events.onMessageUpdated((event) => {
    io.to(conversationRoom(event.conversationId)).emit('message:updated', event.message);
  });

  const unsubscribeMessageDeleted = options.events.onMessageDeleted((event) => {
    io.to(conversationRoom(event.conversationId)).emit('message:deleted', event.message);
  });

  const unsubscribeMessageReactionsChanged = options.events.onMessageReactionsChanged((event) => {
    io.to(conversationRoom(event.conversationId)).emit('message:reactions', event);
  });

  const unsubscribeOpened = options.events.onConversationOpened((event) => {
    for (const userId of event.userIds) {
      const room = userRoom(userId);
      // Event payloads may contain all group members, not just the new member.
      // Resolve current membership before admitting any socket from a delayed event.
      const admissions = [...io.sockets.sockets.values()]
        .filter((socket) => socket.rooms.has(room))
        .map((socket) => ({ socket, admission: beginAdmission(socket, userId) }))
        .filter((entry): entry is { socket: Socket; admission: Admission } => entry.admission !== null);
      if (admissions.length > 0) {
        void resolveConversationMembership(options.database, event.conversationId, userId)
          .then((membership) => {
            if (!membership) return;
            for (const { socket, admission } of admissions) {
              if (!admission.invalidFor(event.conversationId))
                socket.join(conversationRoom(event.conversationId));
            }
          })
          .catch(() => {})
          .finally(() => admissions.forEach(({ admission }) => admission.finish()));
      }
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
      presenceFanouts.get(userId)?.activeRead?.removedConversations.add(event.conversationId);
      for (const admission of [...(admissionsByUser.get(userId) ?? [])]) {
        if (admission.removedConversations.size >= MAX_REMOVALS_PER_ADMISSION &&
            !admission.removedConversations.has(event.conversationId)) {
          admission.cancelled = true;
          admission.finish();
        } else {
          admission.removedConversations.add(event.conversationId);
        }
      }
      const room = userRoom(userId);
      io.in(room).socketsLeave(conversationRoom(event.conversationId));
      io.to(room).emit('conversation:removed', { conversationId: event.conversationId });
    }

    for (const userId of event.remainingUserIds) {
      io.to(userRoom(userId)).emit('conversation:updated', { conversationId: event.conversationId });
    }
  });

  const unsubscribeProfileChanged = options.events.onProfileChanged((event) => {
    const existing = profileFanouts.get(event.userId);
    if (existing) {
      existing.version += 1;
      existing.event = event;
      return;
    }
    const fanout = { version: 1, event };
    profileFanouts.set(event.userId, fanout);
    void (async () => {
      try {
        while (true) {
          const version = fanout.version;
          const latest = fanout.event;
          let rooms: string[] = [];
          try {
            const memberships = await options.database.pool.query<{ conversation_id: string }>(
              'select conversation_id from conversation_members where user_id = $1', [event.userId]
            );
            rooms = memberships.rows.map((row) => row.conversation_id);
          } catch {
            // Database uncertainty cannot authorize sharing profile updates.
          }
          if (version === fanout.version) {
            io.to([
              userRoom(event.userId),
              ...rooms.map((roomId) => conversationRoom(roomId))
            ]).emit('profile:changed', latest);
            break;
          }
        }
      } finally {
        if (profileFanouts.get(event.userId) === fanout) profileFanouts.delete(event.userId);
      }
    })();
  });

  const unsubscribeInvites = options.events.onGroupInvitesChanged((event) => {
    for (const userId of event.userIds) {
      io.to(userRoom(userId)).emit('group:invites:updated');
    }
  });

  const unsubscribeSessionRevoked = options.events.onSessionRevoked((event) => {
    registry.disconnectSession(event.sessionId);
  });

  const unsubscribeDirectBlocked = options.events.onDirectBlocked((event) => {
    const pendingStarts = [...(pendingCallStartsByConversation.get(event.conversationId) ?? [])];
    for (const pending of pendingStarts) invalidateCallStart(pending, event.blockerId);
    // An in-flight insert must commit before its terminal update. Its owner
    // performs that update after the insert; do not race it here.
    const pendingCall = pendingStarts.find((pending) => pending.finished);
    if (pendingCall) return;
    const finished = calls.terminateForBlock(event.conversationId, event.blockerId);
    if (!finished) return;
    clearRingTimer(finished.call.id);
    void persistCallFinished(
      options.database,
      finished.call,
      finished.state,
      finished.actorId
    ).then(() => {
      if (finished.state === 'ended') {
        options.events.emitCallAuthorizationEnded({
          callId: finished.call.id,
          conversationId: finished.call.conversationId
        });
      }
      emitCallState(finished.call, finished.state, finished.actorId);
    }).catch(() => {});
  });

  return {
    registry,
    revalidateSessions: revalidateActiveSessions,
    get pendingAdmissionCount() {
      let count = 0;
      for (const admissions of admissionsBySocket.values()) count += admissions.size;
      return count;
    },
    async close() {
      clearInterval(revalidationTimer);
      await activeRevalidation?.catch(() => {});
      for (const timer of ringTimers.values()) clearTimeout(timer);
      ringTimers.clear();
      unsubscribeMessage();
      unsubscribeMessageUpdated();
      unsubscribeMessageDeleted();
      unsubscribeMessageReactionsChanged();
      unsubscribeOpened();
      unsubscribeChanged();
      unsubscribeRemoved();
      unsubscribeInvites();
      unsubscribeSessionRevoked();
      unsubscribeProfileChanged();
      unsubscribeDirectBlocked();
      io.disconnectSockets(true);
      presence.clear();
      presenceFanouts.clear();
      profileFanouts.clear();
      await new Promise<void>((resolve) => io.close(() => resolve()));
    }
  };
}
