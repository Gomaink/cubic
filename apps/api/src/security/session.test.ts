import assert from 'node:assert/strict';
import test from 'node:test';
import cookie from '@fastify/cookie';
import Fastify from 'fastify';
import { createRequireAuth } from '../auth/guard.js';
import {
  classifySessionClient,
  digestSessionToken,
  SessionService,
  type SessionRecord,
  type SessionRepository
} from './session.js';

const userId = '10000000-0000-4000-8000-000000000001';
const sessionId = '60000000-0000-4000-8000-000000000001';

function record(overrides: {
  id?: string;
  userId?: string;
  clientLabel?: string | null;
  lastSeenAt?: Date;
  expiresAt?: Date;
  disabledAt?: Date | null;
} = {}): SessionRecord {
  return {
    session: {
      id: overrides.id ?? sessionId,
      userId: overrides.userId ?? userId,
      tokenHash: digestSessionToken('valid-token'),
      clientLabel: overrides.clientLabel ?? null,
      createdAt: new Date('2026-09-13T00:00:00.000Z'),
      lastSeenAt: overrides.lastSeenAt ?? new Date('2026-09-13T11:58:00.000Z'),
      expiresAt: overrides.expiresAt ?? new Date('2026-09-14T12:00:00.000Z')
    },
    user: {
      id: userId,
      legacyId: null,
      email: 'user@example.test',
      emailNormalized: 'user@example.test',
      username: 'user',
      usernameNormalized: 'user',
      displayName: 'User',
      passwordHash: 'not-used',
      avatarUrl: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      lastLoginAt: null,
      disabledAt: overrides.disabledAt ?? null
    }
  };
}

class MemorySessionRepository implements SessionRepository {
  records = new Map<string, SessionRecord>();
  touchCount = 0;
  insertedTokenHash: string | null = null;
  insertedClientLabel: string | null = null;
  failPersistence = false;

  add(value: SessionRecord): void {
    this.records.set(value.session.id, value);
  }

  async insert(insertedUserId: string, tokenHash: string, expiresAt: Date, clientLabel: string): Promise<void> {
    if (this.failPersistence) throw new Error('database details that must remain private');
    this.insertedTokenHash = tokenHash;
    this.insertedClientLabel = clientLabel;
    const value = record({ expiresAt });
    value.session.userId = insertedUserId;
    value.session.tokenHash = tokenHash;
    this.add(value);
  }

  async findByTokenHash(tokenHash: string): Promise<SessionRecord | null> {
    if (this.failPersistence) throw new Error('database details that must remain private');
    return [...this.records.values()].find((value) => value.session.tokenHash === tokenHash) ?? null;
  }

  async findById(id: string): Promise<SessionRecord | null> {
    if (this.failPersistence) throw new Error('database details that must remain private');
    return this.records.get(id) ?? null;
  }

  async listActiveForUser(listedUserId: string, now: Date, idleCutoff: Date) {
    if (this.failPersistence) throw new Error('database details that must remain private');
    return [...this.records.values()]
      .filter((value) =>
        value.session.userId === listedUserId &&
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

  async touch(id: string, lastSeenAt: Date, staleBefore: Date): Promise<void> {
    const value = this.records.get(id);
    if (value && value.session.lastSeenAt.getTime() <= staleBefore.getTime()) {
      value.session.lastSeenAt = lastSeenAt;
      this.touchCount += 1;
    }
  }

  async deleteByTokenHash(tokenHash: string): Promise<string | null> {
    if (this.failPersistence) throw new Error('database details that must remain private');
    const value = await this.findByTokenHash(tokenHash);
    if (!value) return null;
    this.records.delete(value.session.id);
    return value.session.id;
  }

  async deleteForUser(id: string, deletedUserId: string): Promise<string | null> {
    if (this.failPersistence) throw new Error('database details that must remain private');
    const value = this.records.get(id);
    if (!value || value.session.userId !== deletedUserId) return null;
    this.records.delete(id);
    return id;
  }

  async deleteOthersForUser(deletedUserId: string, currentSessionId: string): Promise<string[]> {
    if (this.failPersistence) throw new Error('database details that must remain private');
    const deletedIds: string[] = [];
    for (const [id, value] of this.records) {
      if (value.session.userId === deletedUserId && id !== currentSessionId) {
        this.records.delete(id);
        deletedIds.push(id);
      }
    }
    return deletedIds;
  }

  async deleteAllForUser(deletedUserId: string): Promise<string[]> {
    if (this.failPersistence) throw new Error('database details that must remain private');
    const deletedIds: string[] = [];
    for (const [id, value] of this.records) {
      if (value.session.userId === deletedUserId) {
        this.records.delete(id);
        deletedIds.push(id);
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

test('session token digests are stable and do not expose the token', () => {
  const token = 'example-session-token';
  const digest = digestSessionToken(token);

  assert.equal(digest, digestSessionToken(token));
  assert.notEqual(digest, token);
  assert.match(digest, /^[a-f0-9]{64}$/);
});

test('session client classifier uses only bounded coarse labels with unambiguous ordering', () => {
  const cases = [
    ['Mozilla Windows Chrome/120 Safari/537.36 Edg/120', 'Edge on Windows'],
    ['Mozilla Windows Chrome/120 Safari/537.36', 'Chrome on Windows'],
    ['Mozilla Linux Firefox/130', 'Firefox on Linux'],
    ['Mozilla iPhone AppleWebKit Mobile/15 Safari/604.1', 'Safari on iPhone'],
    ['Mozilla Macintosh AppleWebKit Version/17 Safari/605.1', 'Safari on macOS'],
    ['Mozilla iPhone AppleWebKit CriOS/120 Mobile/15 Safari/604.1', 'Chrome on iPhone'],
    ['Mozilla Macintosh AppleWebKit FxiOS/130 Mobile/15 Safari/605.1', 'Firefox on iPad'],
    ['arbitrary hostile <script>alert(1)</script> Mobile', 'Other browser on mobile'],
    ['', 'Unknown client']
  ] as const;

  for (const [userAgent, expected] of cases) {
    assert.equal(classifySessionClient(userAgent), expected);
    assert.ok(classifySessionClient(userAgent).length <= 96);
  }
  assert.equal(classifySessionClient(undefined), 'Unknown client');
  assert.doesNotMatch(classifySessionClient(cases[7][0]), /script|alert/i);
});

test('active session remains valid inside the idle and absolute windows', async () => {
  const repository = new MemorySessionRepository();
  repository.add(record());
  const service = new SessionService(repository, 10 * 60_000, () => new Date('2026-09-13T12:00:00.000Z'));

  const identity = await service.resolveToken('valid-token', { activity: true });

  assert.equal(identity?.sessionId, sessionId);
  assert.equal(repository.touchCount, 0);
});

test('authenticated activity refreshes last_seen_at with bounded writes', async () => {
  const repository = new MemorySessionRepository();
  const value = record({ lastSeenAt: new Date('2026-09-13T11:54:00.000Z') });
  repository.add(value);
  let now = new Date('2026-09-13T12:00:00.000Z');
  const service = new SessionService(repository, 30 * 60_000, () => now);

  assert.ok(await service.resolveToken('valid-token', { activity: true }));
  assert.equal(value.session.lastSeenAt.toISOString(), '2026-09-13T12:00:00.000Z');
  assert.equal(repository.touchCount, 1);

  now = new Date('2026-09-13T12:01:00.000Z');
  assert.ok(await service.resolveToken('valid-token', { activity: true }));
  assert.equal(repository.touchCount, 1);
});

test('idle expiry rejects a session without refreshing it', async () => {
  const repository = new MemorySessionRepository();
  repository.add(record({ lastSeenAt: new Date('2026-09-13T11:50:00.000Z') }));
  const service = new SessionService(repository, 10 * 60_000, () => new Date('2026-09-13T12:00:00.000Z'));

  assert.equal(await service.resolveToken('valid-token', { activity: true }), null);
  assert.equal(await service.validateId(sessionId, { activity: false }), null);
  assert.equal(repository.touchCount, 0);
});

test('absolute expiry remains independent of fresh idle activity', async () => {
  const repository = new MemorySessionRepository();
  repository.add(record({
    lastSeenAt: new Date('2026-09-13T11:59:59.000Z'),
    expiresAt: new Date('2026-09-13T12:00:00.000Z')
  }));
  const service = new SessionService(repository, 10 * 60_000, () => new Date('2026-09-13T12:00:00.000Z'));

  assert.equal(await service.resolveToken('valid-token'), null);
});

test('disabled account is invalid through token and session-id lookup', async () => {
  const repository = new MemorySessionRepository();
  repository.add(record({ disabledAt: new Date('2026-09-13T11:59:00.000Z') }));
  const service = new SessionService(repository, 10 * 60_000, () => new Date('2026-09-13T12:00:00.000Z'));

  assert.equal(await service.resolveToken('valid-token'), null);
  assert.equal(await service.validateId(sessionId), null);
});

test('new sessions persist only a digest, a coarse client label, and absolute expiry', async () => {
  const repository = new MemorySessionRepository();
  const now = new Date('2026-09-13T12:00:00.000Z');
  const service = new SessionService(repository, 10 * 60_000, () => now);

  const created = await service.create(userId, 30, 'Mozilla Windows Firefox/130');

  assert.notEqual(repository.insertedTokenHash, created.token);
  assert.equal(repository.insertedTokenHash, digestSessionToken(created.token));
  assert.equal(repository.insertedClientLabel, 'Firefox on Windows');
  assert.equal(created.expiresAt.getTime(), now.getTime() + 30 * 24 * 60 * 60 * 1000);

  const hostileHeader = 'arbitrary <script>header-content</script> Mobile';
  await service.create(userId, 30, hostileHeader);
  assert.equal(repository.insertedClientLabel, 'Other browser on mobile');
  assert.notEqual(repository.insertedClientLabel, hostileHeader);
});

test('active-session listing uses strict idle and absolute boundaries and hides persistence fields', async () => {
  const repository = new MemorySessionRepository();
  const now = new Date('2026-09-13T12:00:00.000Z');
  const activeId = '60000000-0000-4000-8000-000000000002';
  repository.add(record({
    id: activeId,
    clientLabel: 'Firefox on Linux',
    lastSeenAt: new Date('2026-09-13T11:55:00.001Z')
  }));
  repository.add(record({
    id: '60000000-0000-4000-8000-000000000003',
    lastSeenAt: new Date('2026-09-13T11:55:00.000Z')
  }));
  repository.add(record({
    id: '60000000-0000-4000-8000-000000000004',
    expiresAt: now
  }));
  repository.add(record({
    id: '60000000-0000-4000-8000-000000000005',
    userId: '10000000-0000-4000-8000-000000000002'
  }));
  const service = new SessionService(repository, 5 * 60_000, () => now);

  const listed = await service.listActiveForUser(userId);

  assert.deepEqual(listed.map((value) => value.id), [activeId]);
  assert.equal(listed[0]?.client, 'Firefox on Linux');
  assert.deepEqual(Object.keys(listed[0] ?? {}).sort(), [
    'client', 'createdAt', 'expiresAt', 'id', 'lastSeenAt'
  ]);
});

test('legacy sessions without a client label display as Unknown client', async () => {
  const repository = new MemorySessionRepository();
  repository.add(record());
  const service = new SessionService(repository, 10 * 60_000, () => new Date('2026-09-13T12:00:00.000Z'));

  assert.equal((await service.listActiveForUser(userId))[0]?.client, 'Unknown client');
});

test('session listing rejects persisted labels outside the server-defined set', async () => {
  const repository = new MemorySessionRepository();
  repository.add(record({ clientLabel: 'Firefox on Linux<script>' }));
  const service = new SessionService(repository, 10 * 60_000, () => new Date('2026-09-13T12:00:00.000Z'));

  assert.equal((await service.listActiveForUser(userId))[0]?.client, 'Unknown client');
});

test('owned, other-session, and all-session deletes remain scoped to their user', async () => {
  const repository = new MemorySessionRepository();
  const currentId = '60000000-0000-4000-8000-000000000010';
  const otherId = '60000000-0000-4000-8000-000000000011';
  const foreignId = '60000000-0000-4000-8000-000000000012';
  repository.add(record({ id: currentId }));
  repository.add(record({ id: otherId }));
  repository.add(record({ id: foreignId, userId: '10000000-0000-4000-8000-000000000002' }));
  const service = new SessionService(repository, 10 * 60_000);

  assert.equal(await service.deleteForUser(foreignId, userId), null);
  assert.deepEqual(await service.deleteOthersForUser(userId, currentId), [otherId]);
  assert.equal(repository.records.has(currentId), true);
  assert.equal(repository.records.has(foreignId), true);
  assert.deepEqual(await service.deleteAllForUser(userId), [currentId]);
  assert.equal(repository.records.has(foreignId), true);
});

test('session persistence failures do not expose tokens, digests, or query details', async () => {
  const repository = new MemorySessionRepository();
  const token = 'raw-secret-session-token';
  const digest = digestSessionToken(token);
  repository.findByTokenHash = async () => {
    throw new Error(`failed query with params ${digest}`);
  };
  const service = new SessionService(repository, 30 * 60_000);

  await assert.rejects(
    () => service.resolveToken(token),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, 'Session persistence is temporarily unavailable.');
      assert.doesNotMatch(error.message, new RegExp(`${token}|${digest}`));
      return true;
    }
  );
});

test('authenticated HTTP activity refreshes last_seen and an idle cookie is rejected and cleared', async (context) => {
  const repository = new MemorySessionRepository();
  const value = record({ lastSeenAt: new Date('2026-09-13T11:54:00.000Z') });
  repository.add(value);
  let now = new Date('2026-09-13T12:00:00.000Z');
  const service = new SessionService(repository, 30 * 60_000, () => now);
  const app = Fastify({ logger: false });
  context.after(() => app.close());
  await app.register(cookie);
  app.decorateRequest('auth', null);
  app.get('/protected', {
    preHandler: createRequireAuth(service, 'session')
  }, async (request) => ({ userId: request.auth?.user.id }));

  const active = await app.inject({
    method: 'GET',
    url: '/protected',
    headers: { cookie: 'session=valid-token' }
  });
  assert.equal(active.statusCode, 200);
  assert.equal(active.json().userId, userId);
  assert.equal(repository.touchCount, 1);
  assert.equal(value.session.lastSeenAt.toISOString(), '2026-09-13T12:00:00.000Z');

  now = new Date('2026-09-13T12:30:00.000Z');
  const idle = await app.inject({
    method: 'GET',
    url: '/protected',
    headers: { cookie: 'session=valid-token' }
  });
  assert.equal(idle.statusCode, 401);
  const clearedCookie = idle.headers['set-cookie'];
  assert.match(Array.isArray(clearedCookie) ? clearedCookie.join('; ') : (clearedCookie ?? ''), /session=;/);
});

test('authenticated HTTP requests return a generic 503 when session persistence is unavailable', async (context) => {
  const repository = new MemorySessionRepository();
  repository.add(record());
  repository.failPersistence = true;
  const service = new SessionService(repository, 30 * 60_000);
  const app = Fastify({ logger: false });
  context.after(() => app.close());
  await app.register(cookie);
  app.decorateRequest('auth', null);
  app.get('/protected', { preHandler: createRequireAuth(service, 'session') }, async () => ({ ok: true }));

  const response = await app.inject({
    method: 'GET',
    url: '/protected',
    headers: { cookie: 'session=valid-token' }
  });

  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.json(), { error: 'Session service is temporarily unavailable.' });
  assert.equal(response.headers['set-cookie'], undefined);
});
