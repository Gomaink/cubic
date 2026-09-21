import { createHash, randomBytes } from 'node:crypto';
import { and, desc, eq, gt, lt, lte, ne, or } from 'drizzle-orm';
import type { Database } from '@cubic/database';
import { sessions, users } from '@cubic/database/schema';
import type { PublicUser } from '@cubic/shared';
import { toPublicUser } from '../auth/identity.js';

const SESSION_TOKEN_BYTES = 32;
const MAX_TOUCH_INTERVAL_MS = 5 * 60 * 1000;
const UNKNOWN_CLIENT = 'Unknown client';
const CLIENT_BROWSERS = ['Edge', 'Firefox', 'Chrome', 'Safari', 'Other browser'] as const;
const CLIENT_PLATFORMS = ['iPhone', 'iPad', 'Android', 'Windows', 'macOS', 'Linux', 'mobile'] as const;
const SESSION_CLIENT_LABELS = new Set<string>([
  UNKNOWN_CLIENT,
  ...CLIENT_BROWSERS.flatMap((browser) =>
    CLIENT_PLATFORMS.map((platform) => `${browser} on ${platform}`)
  )
]);

export class SessionPersistenceError extends Error {
  constructor() {
    super('Session persistence is temporarily unavailable.');
    this.name = 'SessionPersistenceError';
  }
}

type SessionRow = typeof sessions.$inferSelect;
type UserRow = typeof users.$inferSelect;

export interface ActiveSession {
  id: string;
  client: string;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
}

interface ActiveSessionRow {
  id: string;
  clientLabel: string | null;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
}

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
  insert(userId: string, tokenHash: string, expiresAt: Date, clientLabel: string): Promise<void>;
  findByTokenHash(tokenHash: string): Promise<SessionRecord | null>;
  findById(sessionId: string): Promise<SessionRecord | null>;
  listActiveForUser(userId: string, now: Date, idleCutoff: Date): Promise<ActiveSessionRow[]>;
  touch(sessionId: string, lastSeenAt: Date, staleBefore: Date): Promise<void>;
  deleteByTokenHash(tokenHash: string): Promise<string | null>;
  deleteForUser(sessionId: string, userId: string): Promise<string | null>;
  deleteOthersForUser(userId: string, currentSessionId: string): Promise<string[]>;
  deleteAllForUser(userId: string): Promise<string[]>;
  deleteInvalid(absoluteCutoff: Date, idleCutoff: Date): Promise<void>;
}

export interface SessionValidationOptions {
  activity?: boolean;
}

export function digestSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function classifySessionClient(userAgent: string | undefined): string {
  if (!userAgent?.trim()) return UNKNOWN_CLIENT;

  let browser: 'Edge' | 'Firefox' | 'Chrome' | 'Safari' | 'Other browser';
  if (/(?:Edg|EdgA|EdgiOS|Edge)\//i.test(userAgent)) browser = 'Edge';
  else if (/(?:Firefox|FxiOS)\//i.test(userAgent)) browser = 'Firefox';
  else if (/(?:Chrome|CriOS)\//i.test(userAgent)) browser = 'Chrome';
  else if (/Safari\//i.test(userAgent)) browser = 'Safari';
  else browser = 'Other browser';

  let platform: 'iPhone' | 'iPad' | 'Android' | 'Windows' | 'macOS' | 'Linux' | 'mobile' | null;
  if (/(?:iPhone|iPod)/i.test(userAgent)) platform = 'iPhone';
  else if (/iPad/i.test(userAgent) || (/Macintosh/i.test(userAgent) && /Mobile\//i.test(userAgent))) platform = 'iPad';
  else if (/Android/i.test(userAgent)) platform = 'Android';
  else if (/Windows/i.test(userAgent)) platform = 'Windows';
  else if (/(?:Macintosh|Mac OS X)/i.test(userAgent)) platform = 'macOS';
  else if (/Linux/i.test(userAgent)) platform = 'Linux';
  else if (/Mobile/i.test(userAgent)) platform = 'mobile';
  else platform = null;

  return platform ? `${browser} on ${platform}` : UNKNOWN_CLIENT;
}

function safeSessionClientLabel(clientLabel: string | null): string {
  return clientLabel && SESSION_CLIENT_LABELS.has(clientLabel) ? clientLabel : UNKNOWN_CLIENT;
}

export function createDatabaseSessionRepository(database: Database): SessionRepository {
  const selectRecord = () => database.db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id));

  return {
    async insert(userId, tokenHash, expiresAt, clientLabel) {
      await database.db.insert(sessions).values({ userId, tokenHash, expiresAt, clientLabel });
    },

    async findByTokenHash(tokenHash) {
      const rows = await selectRecord().where(eq(sessions.tokenHash, tokenHash)).limit(1);
      return rows[0] ?? null;
    },

    async findById(sessionId) {
      const rows = await selectRecord().where(eq(sessions.id, sessionId)).limit(1);
      return rows[0] ?? null;
    },

    async listActiveForUser(userId, now, idleCutoff) {
      return await database.db
        .select({
          id: sessions.id,
          clientLabel: sessions.clientLabel,
          createdAt: sessions.createdAt,
          lastSeenAt: sessions.lastSeenAt,
          expiresAt: sessions.expiresAt
        })
        .from(sessions)
        .where(and(
          eq(sessions.userId, userId),
          gt(sessions.expiresAt, now),
          gt(sessions.lastSeenAt, idleCutoff)
        ))
        .orderBy(desc(sessions.lastSeenAt));
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

    async deleteForUser(sessionId, userId) {
      const rows = await database.db
        .delete(sessions)
        .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId)))
        .returning({ id: sessions.id });
      return rows[0]?.id ?? null;
    },

    async deleteOthersForUser(userId, currentSessionId) {
      const rows = await database.db
        .delete(sessions)
        .where(and(eq(sessions.userId, userId), ne(sessions.id, currentSessionId)))
        .returning({ id: sessions.id });
      return rows.map((row) => row.id);
    },

    async deleteAllForUser(userId) {
      const rows = await database.db
        .delete(sessions)
        .where(eq(sessions.userId, userId))
        .returning({ id: sessions.id });
      return rows.map((row) => row.id);
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

  async create(
    userId: string,
    ttlDays: number,
    userAgent?: string
  ): Promise<{ token: string; expiresAt: Date }> {
    const token = randomBytes(SESSION_TOKEN_BYTES).toString('base64url');
    const tokenHash = digestSessionToken(token);
    const expiresAt = new Date(this.now().getTime() + ttlDays * 24 * 60 * 60 * 1000);
    const clientLabel = classifySessionClient(userAgent);

    try {
      await this.repository.insert(userId, tokenHash, expiresAt, clientLabel);
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

  async listActiveForUser(userId: string): Promise<ActiveSession[]> {
    const now = this.now();
    try {
      const rows = await this.repository.listActiveForUser(
        userId,
        now,
        new Date(now.getTime() - this.idleTimeoutMs)
      );
      return rows.map((row) => ({
        id: row.id,
        client: safeSessionClientLabel(row.clientLabel),
        createdAt: row.createdAt,
        lastSeenAt: row.lastSeenAt,
        expiresAt: row.expiresAt
      }));
    } catch {
      throw new SessionPersistenceError();
    }
  }

  async deleteForUser(sessionId: string, userId: string): Promise<string | null> {
    try {
      return await this.repository.deleteForUser(sessionId, userId);
    } catch {
      throw new SessionPersistenceError();
    }
  }

  async deleteOthersForUser(userId: string, currentSessionId: string): Promise<string[]> {
    try {
      return await this.repository.deleteOthersForUser(userId, currentSessionId);
    } catch {
      throw new SessionPersistenceError();
    }
  }

  async deleteAllForUser(userId: string): Promise<string[]> {
    try {
      return await this.repository.deleteAllForUser(userId);
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
