import assert from 'node:assert/strict';
import test from 'node:test';
import cookie from '@fastify/cookie';
import Fastify from 'fastify';
import { createRequireAuth } from '../auth/guard.js';
import {
  digestSessionToken,
  SessionService,
  type SessionRecord,
  type SessionRepository
} from './session.js';

const userId = '10000000-0000-4000-8000-000000000001';
const sessionId = '60000000-0000-4000-8000-000000000001';

function record(overrides: {
  lastSeenAt?: Date;
  expiresAt?: Date;
  disabledAt?: Date | null;
} = {}): SessionRecord {
  return {
    session: {
      id: sessionId,
      userId,
      tokenHash: digestSessionToken('valid-token'),
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

  add(value: SessionRecord): void {
    this.records.set(value.session.id, value);
  }

  async insert(insertedUserId: string, tokenHash: string, expiresAt: Date): Promise<void> {
    this.insertedTokenHash = tokenHash;
    const value = record({ expiresAt });
    value.session.userId = insertedUserId;
    value.session.tokenHash = tokenHash;
    this.add(value);
  }

  async findByTokenHash(tokenHash: string): Promise<SessionRecord | null> {
    return [...this.records.values()].find((value) => value.session.tokenHash === tokenHash) ?? null;
  }

  async findById(id: string): Promise<SessionRecord | null> {
    return this.records.get(id) ?? null;
  }

  async touch(id: string, lastSeenAt: Date, staleBefore: Date): Promise<void> {
    const value = this.records.get(id);
    if (value && value.session.lastSeenAt.getTime() <= staleBefore.getTime()) {
      value.session.lastSeenAt = lastSeenAt;
      this.touchCount += 1;
    }
  }

  async deleteByTokenHash(tokenHash: string): Promise<string | null> {
    const value = await this.findByTokenHash(tokenHash);
    if (!value) return null;
    this.records.delete(value.session.id);
    return value.session.id;
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

test('new sessions persist only a digest and retain absolute expiry', async () => {
  const repository = new MemorySessionRepository();
  const now = new Date('2026-09-13T12:00:00.000Z');
  const service = new SessionService(repository, 10 * 60_000, () => now);

  const created = await service.create(userId, 30);

  assert.notEqual(repository.insertedTokenHash, created.token);
  assert.equal(repository.insertedTokenHash, digestSessionToken(created.token));
  assert.equal(created.expiresAt.getTime(), now.getTime() + 30 * 24 * 60 * 60 * 1000);
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
