import type { IncomingMessage, Server as HttpServer } from 'node:http';
import { and, eq } from 'drizzle-orm';
import { Server } from 'socket.io';
import { z } from 'zod';
import type { Database } from '@cubic/database';
import { conversationMembers } from '@cubic/database/schema';
import { resolveSession, type SessionIdentity } from '../security/session.js';
import type { RealtimeEvents } from './events.js';

const joinSchema = z.object({ conversationId: z.string().uuid() });

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
