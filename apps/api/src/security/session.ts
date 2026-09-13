import { createHash, randomBytes } from 'node:crypto';
import { and, eq, lt, lte, or } from 'drizzle-orm';
import type { Database } from '@cubic/database';
import { sessions, users } from '@cubic/database/schema';
import type { PublicUser } from '@cubic/shared';
import { toPublicUser } from '../auth/identity.js';

const SESSION_TOKEN_BYTES = 32;
const MAX_TOUCH_INTERVAL_MS = 5 * 60 * 1000;

class SessionPersistenceError extends Error {
  constructor() {
    super('Session persistence is temporarily unavailable.');
    this.name = 'SessionPersistenceError';
  }
}

type SessionRow = typeof sessions.$inferSelect;
type UserRow = typeof users.$inferSelect;

export interface SessionIdentity {
  sessionId: string;
  user: PublicUser;
  expiresAt: Date;
}

export interface SessionRecord {
  session: SessionRow;
  user: UserRow;
}

export interface SessionRepository {
  insert(userId: string, tokenHash: string, expiresAt: Date): Promise<void>;
  findByTokenHash(tokenHash: string): Promise<SessionRecord | null>;
  findById(sessionId: string): Promise<SessionRecord | null>;
  touch(sessionId: string, lastSeenAt: Date, staleBefore: Date): Promise<void>;
  deleteByTokenHash(tokenHash: string): Promise<string | null>;
  deleteInvalid(absoluteCutoff: Date, idleCutoff: Date): Promise<void>;
}

export interface SessionValidationOptions {
  activity?: boolean;
}

export function digestSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function createDatabaseSessionRepository(database: Database): SessionRepository {
  const selectRecord = () => database.db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id));

  return {
    async insert(userId, tokenHash, expiresAt) {
      await database.db.insert(sessions).values({ userId, tokenHash, expiresAt });
    },

    async findByTokenHash(tokenHash) {
      const rows = await selectRecord().where(eq(sessions.tokenHash, tokenHash)).limit(1);
      return rows[0] ?? null;
    },

    async findById(sessionId) {
      const rows = await selectRecord().where(eq(sessions.id, sessionId)).limit(1);
      return rows[0] ?? null;
    },

    async touch(sessionId, lastSeenAt, staleBefore) {
      await database.db
        .update(sessions)
        .set({ lastSeenAt })
        .where(and(eq(sessions.id, sessionId), lte(sessions.lastSeenAt, staleBefore)));
    },

    async deleteByTokenHash(tokenHash) {
      const rows = await database.db
        .delete(sessions)
        .where(eq(sessions.tokenHash, tokenHash))
        .returning({ id: sessions.id });
      return rows[0]?.id ?? null;
    },

    async deleteInvalid(absoluteCutoff, idleCutoff) {
      await database.db.delete(sessions).where(
        or(lt(sessions.expiresAt, absoluteCutoff), lt(sessions.lastSeenAt, idleCutoff))
      );
    }
  };
}

export class SessionService {
  private readonly touchIntervalMs: number;

  constructor(
    private readonly repository: SessionRepository,
    private readonly idleTimeoutMs: number,
    private readonly now: () => Date = () => new Date()
  ) {
    if (!Number.isSafeInteger(idleTimeoutMs) || idleTimeoutMs <= 0) {
      throw new Error('Session idle timeout must be a positive integer.');
    }
    this.touchIntervalMs = Math.max(
      1,
      Math.min(MAX_TOUCH_INTERVAL_MS, Math.floor(idleTimeoutMs / 2))
    );
  }

  async create(userId: string, ttlDays: number): Promise<{ token: string; expiresAt: Date }> {
    const token = randomBytes(SESSION_TOKEN_BYTES).toString('base64url');
    const tokenHash = digestSessionToken(token);
    const expiresAt = new Date(this.now().getTime() + ttlDays * 24 * 60 * 60 * 1000);

    try {
      await this.repository.insert(userId, tokenHash, expiresAt);
    } catch {
      throw new SessionPersistenceError();
    }
    return { token, expiresAt };
  }

  async resolveToken(
    token: string,
    options: SessionValidationOptions = {}
  ): Promise<SessionIdentity | null> {
    try {
      const record = await this.repository.findByTokenHash(digestSessionToken(token));
      return await this.validateRecord(record, options.activity ?? true);
    } catch {
      throw new SessionPersistenceError();
    }
  }

  async validateId(
    sessionId: string,
    options: SessionValidationOptions = {}
  ): Promise<SessionIdentity | null> {
    try {
      const record = await this.repository.findById(sessionId);
      return await this.validateRecord(record, options.activity ?? false);
    } catch {
      throw new SessionPersistenceError();
    }
  }

  async destroyToken(token: string): Promise<string | null> {
    try {
      return await this.repository.deleteByTokenHash(digestSessionToken(token));
    } catch {
      throw new SessionPersistenceError();
    }
  }

  async deleteInvalid(): Promise<void> {
    const now = this.now();
    try {
      await this.repository.deleteInvalid(now, new Date(now.getTime() - this.idleTimeoutMs));
    } catch {
      throw new SessionPersistenceError();
    }
  }

  private async validateRecord(
    record: SessionRecord | null,
    activity: boolean
  ): Promise<SessionIdentity | null> {
    if (!record) return null;

    const now = this.now();
    if (
      record.user.disabledAt ||
      record.session.expiresAt.getTime() <= now.getTime() ||
      record.session.lastSeenAt.getTime() <= now.getTime() - this.idleTimeoutMs
    ) {
      return null;
    }

    if (
      activity &&
      now.getTime() - record.session.lastSeenAt.getTime() >= this.touchIntervalMs
    ) {
      await this.repository.touch(
        record.session.id,
        now,
        new Date(now.getTime() - this.touchIntervalMs)
      );
    }

    return {
      sessionId: record.session.id,
      user: toPublicUser(record.user),
      expiresAt: record.session.expiresAt
    };
  }
}

export function createSessionService(database: Database, idleTimeoutMs: number): SessionService {
  return new SessionService(createDatabaseSessionRepository(database), idleTimeoutMs);
}
