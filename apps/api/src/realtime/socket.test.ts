import test from 'node:test';
import assert from 'node:assert/strict';
import type { IncomingMessage } from 'node:http';
import { randomUUID } from 'node:crypto';
import cookie from '@fastify/cookie';
import Fastify from 'fastify';
import { io as createClient, type Socket as ClientSocket } from 'socket.io-client';
import type { Database } from '@cubic/database';
import { authRoutes } from '../routes/auth.js';
import {
  SessionService,
  digestSessionToken,
  type SessionRecord,
  type SessionRepository
} from '../security/session.js';
import { createRealtimeEvents, type RealtimeEvents } from './events.js';
import {
  attachRealtime,
  isSameOriginRequest,
  readCookie,
  toSocketSessionIdentity,
  type RealtimeServer
} from './socket.js';

const trustCubicNetwork = (address: string) => address === '172.30.0.5';

test('readCookie extracts and decodes the requested cookie', () => {
  assert.equal(readCookie('a=1; cubic_session=hello%2Fworld; b=2', 'cubic_session'), 'hello/world');
  assert.equal(readCookie('a=1', 'cubic_session'), null);
});

test('isSameOriginRequest uses forwarded host only for a trusted proxy', () => {
  const accepted = {
    headers: {
      origin: 'http://192.168.15.172:3010',
      host: 'api:3001',
      'x-forwarded-host': '192.168.15.172:3010'
    },
    socket: { remoteAddress: '172.30.0.5' }
  } as unknown as IncomingMessage;

  const rejected = {
    headers: {
      origin: 'https://evil.example',
      host: 'api:3001',
      'x-forwarded-host': '192.168.15.172:3010'
    },
    socket: { remoteAddress: '172.30.0.5' }
  } as unknown as IncomingMessage;

  const untrustedSpoof = {
    headers: {
      origin: 'https://evil.example',
      host: 'cubic.example',
      'x-forwarded-host': 'evil.example'
    },
    socket: { remoteAddress: '198.51.100.20' }
  } as unknown as IncomingMessage;

  assert.equal(isSameOriginRequest(accepted, trustCubicNetwork), true);
  assert.equal(isSameOriginRequest(rejected, trustCubicNetwork), false);
  assert.equal(isSameOriginRequest(untrustedSpoof, trustCubicNetwork), false);
});

const conversationId = '20000000-0000-4000-8000-000000000001';

function sessionRecord(
  token: string,
  userId: string,
  options: {
    id?: string;
    clientLabel?: string | null;
    createdAt?: Date;
    lastSeenAt?: Date;
    expiresAt?: Date;
    disabledAt?: Date | null;
  } = {}
): SessionRecord {
  return {
    session: {
      id: options.id ?? randomUUID(),
      userId,
      tokenHash: digestSessionToken(token),
      clientLabel: options.clientLabel ?? null,
      createdAt: options.createdAt ?? new Date(),
      lastSeenAt: options.lastSeenAt ?? new Date(),
      expiresAt: options.expiresAt ?? new Date(Date.now() + 60_000)
    },
    user: {
      id: userId,
      legacyId: null,
      email: `${userId}@example.test`,
      emailNormalized: `${userId}@example.test`,
      username: `user-${userId.slice(-4)}`,
      usernameNormalized: `user-${userId.slice(-4)}`,
      displayName: `User ${userId.slice(-4)}`,
      passwordHash: 'not-used',
      avatarUrl: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      lastLoginAt: null,
      disabledAt: options.disabledAt ?? null
    }
  };
}

class RealtimeSessionRepository implements SessionRepository {
  readonly records = new Map<string, SessionRecord>();
  touchCount = 0;
  failValidation = false;
  failMutation = false;
  findByIdDelayMs = 0;
  activeFindById = 0;
  maximumConcurrentFindById = 0;

  add(token: string, userId: string, options: Parameters<typeof sessionRecord>[2] = {}) {
    const value = sessionRecord(token, userId, options);
    this.records.set(value.session.id, value);
    return value;
  }

  revokeToken(token: string): string | null {
    const value = [...this.records.values()]
      .find((candidate) => candidate.session.tokenHash === digestSessionToken(token));
    if (!value) return null;
    this.records.delete(value.session.id);
    return value.session.id;
  }

  async insert(userId: string, tokenHash: string, expiresAt: Date, clientLabel: string): Promise<void> {
    const value = sessionRecord('temporary', userId, { expiresAt });
    value.session.tokenHash = tokenHash;
    value.session.clientLabel = clientLabel;
    this.records.set(value.session.id, value);
  }

  async findByTokenHash(tokenHash: string): Promise<SessionRecord | null> {
    if (this.failValidation) throw new Error('temporary database failure');
    return [...this.records.values()]
      .find((value) => value.session.tokenHash === tokenHash) ?? null;
  }

  async findById(sessionId: string): Promise<SessionRecord | null> {
    if (this.failValidation) throw new Error('temporary database failure');
    this.activeFindById += 1;
    this.maximumConcurrentFindById = Math.max(
      this.maximumConcurrentFindById,
      this.activeFindById
    );
    try {
      if (this.findByIdDelayMs > 0) await delay(this.findByIdDelayMs);
      return this.records.get(sessionId) ?? null;
    } finally {
      this.activeFindById -= 1;
    }
  }

  async listActiveForUser(userId: string, now: Date, idleCutoff: Date) {
    if (this.failValidation) throw new Error('temporary database failure');
    return [...this.records.values()]
      .filter((value) =>
        value.session.userId === userId &&
        value.session.expiresAt.getTime() > now.getTime() &&
        value.session.lastSeenAt.getTime() > idleCutoff.getTime()
      )
      .sort((left, right) => right.session.lastSeenAt.getTime() - left.session.lastSeenAt.getTime())
      .map((value) => ({
        id: value.session.id,
        clientLabel: value.session.clientLabel,
        createdAt: value.session.createdAt,
        lastSeenAt: value.session.lastSeenAt,
        expiresAt: value.session.expiresAt
      }));
  }

  async touch(sessionId: string, lastSeenAt: Date, staleBefore: Date): Promise<void> {
    const value = this.records.get(sessionId);
    if (value && value.session.lastSeenAt.getTime() <= staleBefore.getTime()) {
      value.session.lastSeenAt = lastSeenAt;
      this.touchCount += 1;
    }
  }

  async deleteByTokenHash(tokenHash: string): Promise<string | null> {
    if (this.failValidation) throw new Error('temporary database failure');
    const value = [...this.records.values()]
      .find((candidate) => candidate.session.tokenHash === tokenHash);
    if (!value) return null;
    this.records.delete(value.session.id);
    return value.session.id;
  }

  async deleteForUser(sessionId: string, userId: string): Promise<string | null> {
    if (this.failValidation || this.failMutation) throw new Error('temporary database failure');
    const value = this.records.get(sessionId);
    if (!value || value.session.userId !== userId) return null;
    this.records.delete(sessionId);
    return sessionId;
  }

  async deleteOthersForUser(userId: string, currentSessionId: string): Promise<string[]> {
    if (this.failValidation || this.failMutation) throw new Error('temporary database failure');
    const deletedIds: string[] = [];
    for (const [sessionId, value] of this.records) {
      if (value.session.userId === userId && sessionId !== currentSessionId) {
        this.records.delete(sessionId);
        deletedIds.push(sessionId);
      }
    }
    return deletedIds;
  }

  async deleteAllForUser(userId: string): Promise<string[]> {
    if (this.failValidation || this.failMutation) throw new Error('temporary database failure');
    const deletedIds: string[] = [];
    for (const [sessionId, value] of this.records) {
      if (value.session.userId === userId) {
        this.records.delete(sessionId);
        deletedIds.push(sessionId);
      }
    }
    return deletedIds;
  }

  async deleteInvalid(absoluteCutoff: Date, idleCutoff: Date): Promise<void> {
    for (const [id, value] of this.records) {
      if (
        value.session.expiresAt.getTime() < absoluteCutoff.getTime() ||
        value.session.lastSeenAt.getTime() < idleCutoff.getTime()
      ) {
        this.records.delete(id);
      }
    }
  }
}

class RealtimeDatabase {
  readonly selectResults: any[][] = [];

  db = {
    select: () => {
      let result: Promise<any[]> | null = null;
      const read = () => result ??= Promise.resolve(this.selectResults.shift() ?? []);
      const builder: any = {
        from: () => builder,
        innerJoin: () => builder,
        where: () => builder,
        orderBy: () => builder,
        limit: () => read(),
        then: (resolve: (value: any[]) => unknown, reject: (error: unknown) => unknown) =>
          read().then(resolve, reject)
      };
      return builder;
    }
  };

  pool = {
    connect: async () => ({
      query: async () => ({ rows: [], rowCount: 0 }),
      release() {}
    }),
    query: async () => ({ rows: [], rowCount: 0 })
  };
}

interface RealtimeHarness {
  app: ReturnType<typeof Fastify>;
  database: RealtimeDatabase;
  events: RealtimeEvents;
  repository: RealtimeSessionRepository;
  realtime: RealtimeServer;
  url: string;
}

async function startRealtimeHarness(options: {
  idleTimeoutMs?: number;
  revalidateIntervalMs?: number;
  pingIntervalMs?: number;
} = {}): Promise<RealtimeHarness> {
  const app = Fastify({ logger: false });
  await app.register(cookie);
  app.decorateRequest('auth', null);

  const database = new RealtimeDatabase();
  const repository = new RealtimeSessionRepository();
  const sessionService = new SessionService(repository, options.idleTimeoutMs ?? 60_000);
  const events = createRealtimeEvents();

  await app.register(authRoutes, {
    prefix: '/api/v1/auth',
    database: database as never,
    cookieName: 'session',
    cookieSecure: false,
    sessionTtlDays: 30,
    registrationEnabled: true,
    sessionService,
    realtimeEvents: events
  });
  await app.ready();

  const realtime = attachRealtime({
    server: app.server,
    database: database as unknown as Database,
    cookieName: 'session',
    sessionService,
    revalidateIntervalMs: options.revalidateIntervalMs ?? 20,
    ...(options.pingIntervalMs === undefined
      ? {}
      : { pingIntervalMs: options.pingIntervalMs, pingTimeoutMs: 50 }),
    trustedProxyCidrs: ['127.0.0.1/32', '::1/128'],
    events
  });

  await app.listen({ host: '127.0.0.1', port: 0 });
  const address = app.server.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not bind TCP.');
  return { app, database, events, repository, realtime, url: `http://127.0.0.1:${address.port}` };
}

async function closeRealtimeHarness(harness: RealtimeHarness): Promise<void> {
  await harness.realtime.close();
  await harness.app.close();
}

function waitForEvent<T = unknown>(socket: ClientSocket, event: string, timeoutMs = 1_500): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${event}`)), timeoutMs);
    socket.once(event, (value: T) => {
      clearTimeout(timer);
      resolve(value);
    });
  });
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function connectClient(
  harness: RealtimeHarness,
  token: string,
  memberships: string[] = []
): Promise<ClientSocket> {
  harness.database.selectResults.push(
    memberships.map((membership) => ({ conversationId: membership }))
  );
  const socket = createClient(harness.url, {
    path: '/socket.io',
    transports: ['websocket'],
    reconnection: false,
    extraHeaders: { cookie: `session=${encodeURIComponent(token)}` }
  });
  await waitForEvent(socket, 'realtime:ready');
  return socket;
}

test('socket identity retains no raw token, digest, or expiry', () => {
  const identity = toSocketSessionIdentity({
    sessionId: '60000000-0000-4000-8000-000000000001',
    expiresAt: new Date('2026-10-01T00:00:00.000Z'),
    user: {
      id: '10000000-0000-4000-8000-000000000001',
      username: 'user',
      displayName: 'User',
      avatarUrl: null,
      createdAt: '2026-01-01T00:00:00.000Z'
    }
  });

  assert.deepEqual(Object.keys(identity).sort(), ['displayName', 'sessionId', 'userId', 'username']);
  assert.doesNotMatch(JSON.stringify(identity), /token|hash|expires/i);
});

test('idle and disabled sessions cannot complete a new Socket.IO handshake', async (context) => {
  const harness = await startRealtimeHarness({ idleTimeoutMs: 100 });
  context.after(() => closeRealtimeHarness(harness));
  const userId = '10000000-0000-4000-8000-000000000001';
  harness.repository.add('idle-token', userId, { lastSeenAt: new Date(Date.now() - 101) });
  harness.repository.add('disabled-token', userId, { disabledAt: new Date() });

  for (const token of ['idle-token', 'disabled-token']) {
    const socket = createClient(harness.url, {
      transports: ['websocket'],
      reconnection: false,
      extraHeaders: { cookie: `session=${token}` }
    });
    const error = await waitForEvent<Error>(socket, 'connect_error');
    assert.match(error.message, /Authentication required/);
    socket.close();
  }
});

test('logout revokes one session and disconnects every matching tab only', async (context) => {
  const harness = await startRealtimeHarness();
  context.after(() => closeRealtimeHarness(harness));
  const sameUser = '10000000-0000-4000-8000-000000000001';
  const otherUser = '10000000-0000-4000-8000-000000000002';
  const revoked = harness.repository.add('revoked-token', sameUser);
  harness.repository.add('other-device-token', sameUser);
  harness.repository.add('other-user-token', otherUser);

  const tabOne = await connectClient(harness, 'revoked-token');
  const tabTwo = await connectClient(harness, 'revoked-token');
  const otherDevice = await connectClient(harness, 'other-device-token');
  const otherPerson = await connectClient(harness, 'other-user-token');
  assert.equal(harness.realtime.registry.socketCount, 4);

  const firstDisconnect = waitForEvent(tabOne, 'disconnect');
  const secondDisconnect = waitForEvent(tabTwo, 'disconnect');
  const response = await fetch(`${harness.url}/api/v1/auth/logout`, {
    method: 'POST',
    headers: { cookie: 'session=revoked-token' }
  });

  assert.equal(response.status, 204);
  await Promise.all([firstDisconnect, secondDisconnect]);
  assert.equal(harness.repository.records.has(revoked.session.id), false);
  assert.equal(otherDevice.connected, true);
  assert.equal(otherPerson.connected, true);
  assert.equal(harness.realtime.registry.socketCount, 2);

  const rejectedHttp = await fetch(`${harness.url}/api/v1/auth/me`, {
    headers: { cookie: 'session=revoked-token' }
  });
  assert.equal(rejectedHttp.status, 401);

  const reconnect = createClient(harness.url, {
    transports: ['websocket'],
    reconnection: false,
    extraHeaders: { cookie: 'session=revoked-token' }
  });
  const error = await waitForEvent<Error>(reconnect, 'connect_error');
  assert.match(error.message, /Authentication required/);
  reconnect.close();
  otherDevice.close();
  otherPerson.close();
});

test('logout does not disconnect before session deletion succeeds', async (context) => {
  const harness = await startRealtimeHarness();
  context.after(() => closeRealtimeHarness(harness));
  harness.repository.add('delete-fails', '10000000-0000-4000-8000-000000000001');
  const socket = await connectClient(harness, 'delete-fails');

  harness.repository.failValidation = true;
  const response = await fetch(`${harness.url}/api/v1/auth/logout`, {
    method: 'POST',
    headers: { cookie: 'session=delete-fails' }
  });

  assert.equal(response.status, 500);
  assert.equal(socket.connected, true);
  assert.equal(harness.realtime.registry.socketCount, 1);
  harness.repository.failValidation = false;
  socket.close();
});

test('active-session API lists only safe owned metadata with the current session first', async (context) => {
  const harness = await startRealtimeHarness();
  context.after(() => closeRealtimeHarness(harness));
  const ownerId = '10000000-0000-4000-8000-000000000001';
  const current = harness.repository.add('list-current', ownerId, {
    clientLabel: 'Firefox on Linux',
    lastSeenAt: new Date(Date.now() - 30_000)
  });
  const other = harness.repository.add('list-other', ownerId, {
    clientLabel: null,
    lastSeenAt: new Date()
  });
  harness.repository.add('list-foreign', '10000000-0000-4000-8000-000000000002', {
    clientLabel: 'Edge on Windows'
  });
  harness.repository.add('list-expired', ownerId, {
    expiresAt: new Date(Date.now() - 1)
  });

  const response = await fetch(`${harness.url}/api/v1/auth/sessions`, {
    headers: { cookie: 'session=list-current' }
  });

  assert.equal(response.status, 200);
  const payload = await response.json() as { sessions: Array<Record<string, unknown>> };
  assert.deepEqual(payload.sessions.map((session) => session.id), [current.session.id, other.session.id]);
  assert.equal(payload.sessions[0]?.current, true);
  assert.equal(payload.sessions[1]?.current, false);
  assert.equal(payload.sessions[1]?.client, 'Unknown client');
  for (const session of payload.sessions) {
    assert.deepEqual(Object.keys(session).sort(), [
      'client', 'createdAt', 'current', 'expiresAt', 'id', 'lastSeenAt'
    ]);
    assert.equal('tokenHash' in session, false);
    assert.equal('token_hash' in session, false);
    assert.equal('userId' in session, false);
    assert.equal('user_id' in session, false);
  }
});

test('revoke-one API is owner-scoped, idempotent, and disconnects every target tab', async (context) => {
  const harness = await startRealtimeHarness();
  context.after(() => closeRealtimeHarness(harness));
  const ownerId = '10000000-0000-4000-8000-000000000001';
  harness.repository.add('revoke-current', ownerId);
  const target = harness.repository.add('revoke-target', ownerId);
  const foreign = harness.repository.add(
    'revoke-foreign',
    '10000000-0000-4000-8000-000000000002'
  );
  const currentSocket = await connectClient(harness, 'revoke-current');
  const targetTabOne = await connectClient(harness, 'revoke-target');
  const targetTabTwo = await connectClient(harness, 'revoke-target');
  const foreignSocket = await connectClient(harness, 'revoke-foreign');
  const firstDisconnect = waitForEvent(targetTabOne, 'disconnect');
  const secondDisconnect = waitForEvent(targetTabTwo, 'disconnect');

  const revoked = await fetch(`${harness.url}/api/v1/auth/sessions/${target.session.id}`, {
    method: 'DELETE',
    headers: { cookie: 'session=revoke-current' }
  });

  assert.equal(revoked.status, 204);
  assert.equal(revoked.headers.get('set-cookie'), null);
  await Promise.all([firstDisconnect, secondDisconnect]);
  assert.equal(currentSocket.connected, true);
  assert.equal(foreignSocket.connected, true);

  const missingId = '60000000-0000-4000-8000-000000000099';
  const repeated = await fetch(`${harness.url}/api/v1/auth/sessions/${target.session.id}`, {
    method: 'DELETE', headers: { cookie: 'session=revoke-current' }
  });
  const missing = await fetch(`${harness.url}/api/v1/auth/sessions/${missingId}`, {
    method: 'DELETE', headers: { cookie: 'session=revoke-current' }
  });
  const foreignAttempt = await fetch(`${harness.url}/api/v1/auth/sessions/${foreign.session.id}`, {
    method: 'DELETE', headers: { cookie: 'session=revoke-current' }
  });
  const malformed = await fetch(`${harness.url}/api/v1/auth/sessions/not-a-uuid`, {
    method: 'DELETE', headers: { cookie: 'session=revoke-current' }
  });
  assert.deepEqual(
    [repeated.status, missing.status, foreignAttempt.status, repeated.headers.get('content-length'), missing.headers.get('content-length'), foreignAttempt.headers.get('content-length')],
    [204, 204, 204, null, null, null]
  );
  assert.equal(malformed.status, 400);
  assert.equal(harness.repository.records.has(foreign.session.id), true);

  const reconnect = createClient(harness.url, {
    transports: ['websocket'],
    reconnection: false,
    extraHeaders: { cookie: 'session=revoke-target' }
  });
  assert.match((await waitForEvent<Error>(reconnect, 'connect_error')).message, /Authentication required/);
  reconnect.close();
  currentSocket.close();
  foreignSocket.close();
});

test('revoke-others preserves current tabs and logout-all disconnects all owned sessions only', async (context) => {
  const harness = await startRealtimeHarness();
  context.after(() => closeRealtimeHarness(harness));
  const ownerId = '10000000-0000-4000-8000-000000000001';
  const current = harness.repository.add('bulk-current', ownerId);
  const other = harness.repository.add('bulk-other', ownerId);
  const foreign = harness.repository.add('bulk-foreign', '10000000-0000-4000-8000-000000000002');
  const currentTabOne = await connectClient(harness, 'bulk-current');
  const currentTabTwo = await connectClient(harness, 'bulk-current');
  const otherSocket = await connectClient(harness, 'bulk-other');
  const foreignSocket = await connectClient(harness, 'bulk-foreign');
  const otherDisconnect = waitForEvent(otherSocket, 'disconnect');

  const revokeOthers = await fetch(`${harness.url}/api/v1/auth/sessions/others`, {
    method: 'DELETE', headers: { cookie: 'session=bulk-current' }
  });
  assert.equal(revokeOthers.status, 204);
  assert.equal(revokeOthers.headers.get('set-cookie'), null);
  await otherDisconnect;
  assert.equal(harness.repository.records.has(current.session.id), true);
  assert.equal(harness.repository.records.has(other.session.id), false);
  assert.equal(harness.repository.records.has(foreign.session.id), true);
  assert.equal(currentTabOne.connected, true);
  assert.equal(currentTabTwo.connected, true);
  assert.equal(foreignSocket.connected, true);

  const later = harness.repository.add('bulk-later', ownerId);
  const laterSocket = await connectClient(harness, 'bulk-later');
  const currentDisconnectOne = waitForEvent(currentTabOne, 'disconnect');
  const currentDisconnectTwo = waitForEvent(currentTabTwo, 'disconnect');
  const laterDisconnect = waitForEvent(laterSocket, 'disconnect');
  const logoutAll = await fetch(`${harness.url}/api/v1/auth/sessions`, {
    method: 'DELETE', headers: { cookie: 'session=bulk-current' }
  });
  assert.equal(logoutAll.status, 204);
  assert.match(logoutAll.headers.get('set-cookie') ?? '', /session=;/);
  await Promise.all([currentDisconnectOne, currentDisconnectTwo, laterDisconnect]);
  assert.equal(harness.repository.records.has(current.session.id), false);
  assert.equal(harness.repository.records.has(later.session.id), false);
  assert.equal(harness.repository.records.has(foreign.session.id), true);
  assert.equal(foreignSocket.connected, true);
  foreignSocket.close();
});

test('session management persistence failure returns generic 503 without cookie or socket side effects', async (context) => {
  const harness = await startRealtimeHarness();
  context.after(() => closeRealtimeHarness(harness));
  const current = harness.repository.add(
    'failure-current',
    '10000000-0000-4000-8000-000000000001'
  );
  const socket = await connectClient(harness, 'failure-current');
  harness.repository.failMutation = true;

  const response = await fetch(`${harness.url}/api/v1/auth/sessions/${current.session.id}`, {
    method: 'DELETE', headers: { cookie: 'session=failure-current' }
  });
  const body = await response.json() as { error?: string };

  assert.equal(response.status, 503);
  assert.deepEqual(body, { error: 'Session management is temporarily unavailable.' });
  assert.equal(response.headers.get('set-cookie'), null);
  assert.equal(harness.repository.records.has(current.session.id), true);
  assert.equal(socket.connected, true);
  socket.close();
});

test('revoking the current session clears its cookie only after deletion and disconnects all tabs', async (context) => {
  const harness = await startRealtimeHarness();
  context.after(() => closeRealtimeHarness(harness));
  const current = harness.repository.add(
    'current-management-session',
    '10000000-0000-4000-8000-000000000001'
  );
  const tabOne = await connectClient(harness, 'current-management-session');
  const tabTwo = await connectClient(harness, 'current-management-session');
  const firstDisconnect = waitForEvent(tabOne, 'disconnect');
  const secondDisconnect = waitForEvent(tabTwo, 'disconnect');

  const response = await fetch(`${harness.url}/api/v1/auth/sessions/${current.session.id}`, {
    method: 'DELETE', headers: { cookie: 'session=current-management-session' }
  });

  assert.equal(response.status, 204);
  assert.match(response.headers.get('set-cookie') ?? '', /session=;/);
  await Promise.all([firstDisconnect, secondDisconnect]);
  assert.equal(harness.repository.records.has(current.session.id), false);
});

test('direct database revocation and later account disabling are found by shared revalidation', async (context) => {
  const harness = await startRealtimeHarness({ revalidateIntervalMs: 20 });
  context.after(() => closeRealtimeHarness(harness));
  const first = harness.repository.add('direct-revoke', '10000000-0000-4000-8000-000000000001');
  const second = harness.repository.add('disable-later', '10000000-0000-4000-8000-000000000002');
  const revokedSocket = await connectClient(harness, 'direct-revoke');
  const disabledSocket = await connectClient(harness, 'disable-later');

  const revokedDisconnect = waitForEvent(revokedSocket, 'disconnect');
  harness.repository.records.delete(first.session.id);
  await revokedDisconnect;
  assert.equal(disabledSocket.connected, true);

  const disabledDisconnect = waitForEvent(disabledSocket, 'disconnect');
  second.user.disabledAt = new Date();
  await disabledDisconnect;
  assert.equal(harness.realtime.registry.socketCount, 0);
});

test('an invalidated session cannot run another client-originated application event', async (context) => {
  const harness = await startRealtimeHarness({ revalidateIntervalMs: 1_000 });
  context.after(() => closeRealtimeHarness(harness));
  const value = harness.repository.add(
    'event-revoke',
    '10000000-0000-4000-8000-000000000001'
  );
  const socket = await connectClient(harness, 'event-revoke');
  harness.repository.records.delete(value.session.id);
  let acknowledgement: any = null;
  const disconnected = waitForEvent(socket, 'disconnect');

  socket.emit('call:sync', {}, (result: unknown) => { acknowledgement = result; });
  await disconnected;
  await delay(20);

  assert.deepEqual(acknowledgement, { ok: false, error: 'Authentication required.' });
  assert.equal(harness.realtime.registry.socketCount, 0);
});

test('Engine.IO heartbeat and server events do not refresh idle activity', async (context) => {
  const harness = await startRealtimeHarness({
    idleTimeoutMs: 120,
    revalidateIntervalMs: 15,
    pingIntervalMs: 10
  });
  context.after(() => closeRealtimeHarness(harness));
  harness.repository.add('heartbeat-only', '10000000-0000-4000-8000-000000000001');
  const socket = await connectClient(harness, 'heartbeat-only', [conversationId]);
  const disconnected = waitForEvent(socket, 'disconnect');

  harness.events.emitConversationChanged({
    conversationId,
    userIds: ['10000000-0000-4000-8000-000000000001']
  });
  await disconnected;

  assert.equal(harness.repository.touchCount, 0);
});

test('client application events refresh activity with bounded writes', async (context) => {
  const harness = await startRealtimeHarness({ idleTimeoutMs: 140, revalidateIntervalMs: 15 });
  context.after(() => closeRealtimeHarness(harness));
  harness.repository.add('active-socket', '10000000-0000-4000-8000-000000000001');
  const socket = await connectClient(harness, 'active-socket');

  await delay(80);
  const first = await new Promise<any>((resolve) => socket.emit('call:sync', {}, resolve));
  assert.equal(first.ok, true);
  assert.equal(harness.repository.touchCount, 1);

  await delay(80);
  assert.equal(socket.connected, true);
  const second = await new Promise<any>((resolve) => socket.emit('call:sync', {}, resolve));
  assert.equal(second.ok, true);
  assert.equal(harness.repository.touchCount, 2);
  socket.close();
});

test('transient revalidation failures preserve established sockets for retry', async (context) => {
  const harness = await startRealtimeHarness({ revalidateIntervalMs: 15 });
  context.after(() => closeRealtimeHarness(harness));
  harness.repository.add('transient-a', '10000000-0000-4000-8000-000000000001');
  harness.repository.add('transient-b', '10000000-0000-4000-8000-000000000002');
  const first = await connectClient(harness, 'transient-a');
  const second = await connectClient(harness, 'transient-b');

  harness.repository.failValidation = true;
  const blockedEvent = await new Promise<any>((resolve) =>
    first.emit('call:sync', {}, resolve)
  );
  assert.deepEqual(blockedEvent, {
    ok: false,
    error: 'Session validation is temporarily unavailable.'
  });
  await delay(70);
  assert.equal(first.connected, true);
  assert.equal(second.connected, true);
  assert.equal(harness.realtime.registry.socketCount, 2);

  harness.repository.failValidation = false;
  await delay(30);
  assert.equal(first.connected, true);
  assert.equal(second.connected, true);
  first.close();
  second.close();
});

test('shared revalidation checks unique sessions sequentially without overlapping sweeps', async (context) => {
  const harness = await startRealtimeHarness({ revalidateIntervalMs: 10 });
  context.after(() => closeRealtimeHarness(harness));
  harness.repository.add('slow-a', '10000000-0000-4000-8000-000000000001');
  harness.repository.add('slow-b', '10000000-0000-4000-8000-000000000002');
  const first = await connectClient(harness, 'slow-a');
  const second = await connectClient(harness, 'slow-b');
  harness.repository.maximumConcurrentFindById = 0;
  harness.repository.findByIdDelayMs = 30;

  await delay(90);

  assert.equal(harness.repository.maximumConcurrentFindById, 1);
  first.close();
  second.close();
});

test('conversation authorization and message mutation propagation remain intact', async (context) => {
  const harness = await startRealtimeHarness();
  context.after(() => closeRealtimeHarness(harness));
  harness.repository.add('member-token', '10000000-0000-4000-8000-000000000001');
  harness.repository.add('outsider-token', '10000000-0000-4000-8000-000000000002');
  const member = await connectClient(harness, 'member-token', [conversationId]);
  const outsider = await connectClient(harness, 'outsider-token');

  harness.database.selectResults.push([]);
  const denied = await new Promise<any>((resolve) =>
    outsider.emit('conversation:join', { conversationId }, resolve)
  );
  assert.deepEqual(denied, { ok: false, error: 'Conversation not found.' });

  const message = {
    id: randomUUID(),
    conversationId,
    senderId: '10000000-0000-4000-8000-000000000001',
    clientMessageId: randomUUID(),
    body: 'hello',
    createdAt: new Date().toISOString(),
    editedAt: null,
    deletedAt: null,
    attachments: [],
    replyTo: null,
    reactions: []
  };
  const created = waitForEvent<any>(member, 'message:created');
  harness.events.emitMessageCreated({ conversationId, message });
  assert.equal((await created).id, message.id);

  const updated = waitForEvent<any>(member, 'message:updated');
  harness.events.emitMessageUpdated({ conversationId, message: { ...message, body: 'edited' } });
  assert.equal((await updated).body, 'edited');

  const deleted = waitForEvent<any>(member, 'message:deleted');
  harness.events.emitMessageDeleted({ conversationId, message: { ...message, deletedAt: new Date().toISOString() } });
  assert.equal((await deleted).id, message.id);

  const reactions = waitForEvent<any>(member, 'message:reactions');
  harness.events.emitMessageReactionsChanged({
    conversationId,
    messageId: message.id,
    userId: message.senderId,
    reaction: '👍',
    active: true,
    reactions: [{ reaction: '👍', count: 1 }]
  });
  assert.equal((await reactions).reaction, '👍');

  await delay(20);
  assert.equal(harness.realtime.registry.socketCount, 2);
  member.close();
  outsider.close();
  await delay(20);
  assert.equal(harness.realtime.registry.socketCount, 0);
});

test('direct-call signalling still starts and accepts across authenticated sockets', async (context) => {
  const harness = await startRealtimeHarness();
  context.after(() => closeRealtimeHarness(harness));
  const callerId = '10000000-0000-4000-8000-000000000001';
  const calleeId = '10000000-0000-4000-8000-000000000002';
  harness.repository.add('caller-token', callerId);
  harness.repository.add('callee-token', calleeId);
  const caller = await connectClient(harness, 'caller-token', [conversationId]);
  const callee = await connectClient(harness, 'callee-token', [conversationId]);

  harness.database.selectResults.push([
    { kind: 'direct', userLowId: callerId, userHighId: calleeId }
  ], []);
  const incoming = waitForEvent<any>(callee, 'call:incoming');
  const started = await new Promise<any>((resolve) =>
    caller.emit('call:start', { conversationId }, resolve)
  );
  assert.equal(started.ok, true);
  assert.equal((await incoming).id, started.call.id);

  const acceptedState = new Promise<any>((resolve) => {
    const listener = (payload: any) => {
      if (payload.id === started.call.id && payload.state === 'accepted') {
        caller.off('call:state', listener);
        resolve(payload);
      }
    };
    caller.on('call:state', listener);
  });
  const accepted = await new Promise<any>((resolve) =>
    callee.emit('call:accept', { callId: started.call.id }, resolve)
  );
  assert.equal(accepted.ok, true);
  assert.equal((await acceptedState).state, 'accepted');
  caller.close();
  callee.close();
});
