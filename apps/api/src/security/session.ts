import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, lt } from 'drizzle-orm';
import type { Database } from '@cubic/database';
import { sessions, users } from '@cubic/database/schema';
import type { PublicUser } from '@cubic/shared';
import { toPublicUser } from '../auth/identity.js';

const SESSION_TOKEN_BYTES = 32;
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

export interface SessionIdentity {
  sessionId: string;
  user: PublicUser;
  expiresAt: Date;
}

export function digestSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function createSession(
  database: Database,
  userId: string,
  ttlDays: number
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(SESSION_TOKEN_BYTES).toString('base64url');
  const tokenHash = digestSessionToken(token);
  const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);

  await database.db.insert(sessions).values({
    userId,
    tokenHash,
    expiresAt
  });

  return { token, expiresAt };
}

export async function resolveSession(
  database: Database,
  token: string
): Promise<SessionIdentity | null> {
  const tokenHash = digestSessionToken(token);
  const now = new Date();

  const rows = await database.db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, now)))
    .limit(1);

  const row = rows[0];
  if (!row || row.user.disabledAt) return null;

  if (now.getTime() - row.session.lastSeenAt.getTime() >= TOUCH_INTERVAL_MS) {
    await database.db
      .update(sessions)
      .set({ lastSeenAt: now })
      .where(eq(sessions.id, row.session.id));
  }

  return {
    sessionId: row.session.id,
    user: toPublicUser(row.user),
    expiresAt: row.session.expiresAt
  };
}

export async function destroySession(database: Database, token: string): Promise<void> {
  await database.db
    .delete(sessions)
    .where(eq(sessions.tokenHash, digestSessionToken(token)));
}

export async function deleteExpiredSessions(database: Database): Promise<void> {
  await database.db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
}
