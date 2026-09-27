import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { eq, or } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '@cubic/database';
import { userSettings, users } from '@cubic/database/schema';
import { normalizeEmail, normalizeUsername, toPublicUser } from '../auth/identity.js';
import { createRequireAuth } from '../auth/guard.js';
import { hashPassword, verifyPassword } from '../security/password.js';
import { SessionPersistenceError, type SessionService } from '../security/session.js';
import type { RealtimeEvents } from '../realtime/events.js';
import type { EmailVerificationService } from '../mail/email-verification.js';

const passwordPolicySchema = z.string().min(10).max(128);

const registerBodySchema = z.object({
  email: z.string().trim().email().max(254),
  username: z
    .string()
    .trim()
    .min(3)
    .max(32)
    .regex(/^[A-Za-z0-9_]+$/, 'Username may only contain letters, numbers and underscores.'),
  displayName: z.string().trim().min(1).max(64),
  password: passwordPolicySchema
});

const loginBodySchema = z.object({
  identifier: z.string().trim().min(1).max(254),
  password: z.string().min(1).max(128)
});

const passwordChangeBodySchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: passwordPolicySchema,
  confirmPassword: z.string().max(128)
}).refine((value) => value.newPassword === value.confirmPassword);

const sessionParamsSchema = z.object({
  sessionId: z.string().uuid()
});

export interface AuthRoutesOptions {
  database: Database;
  cookieName: string;
  cookieSecure: boolean;
  sessionTtlDays: number;
  registrationEnabled: boolean;
  sessionService: SessionService;
  realtimeEvents: RealtimeEvents;
  emailVerification?: EmailVerificationService;
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: string }).code === '23505'
  );
}

export const authRoutes: FastifyPluginAsync<AuthRoutesOptions> = async (app, options) => {
  const requireAuth = createRequireAuth(options.sessionService, options.cookieName);
  const cookieBase = {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: options.cookieSecure,
    path: '/'
  };
  const sessionUnavailable = (reply: FastifyReply) =>
    reply.code(503).send({ error: 'Session management is temporarily unavailable.' });

  app.post(
    '/register',
    {
      config: {
        rateLimit: { max: 5, timeWindow: '10 minutes' }
      }
    },
    async (request, reply) => {
      if (!options.registrationEnabled) {
        return reply.code(403).send({ error: 'Registration is disabled on this Cubic instance.' });
      }

      const parsed = registerBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: 'Invalid registration data.',
          fields: parsed.error.flatten().fieldErrors
        });
      }

      const emailNormalized = normalizeEmail(parsed.data.email);
      const usernameNormalized = normalizeUsername(parsed.data.username);

      const existing = await options.database.db
        .select({ email: users.emailNormalized, username: users.usernameNormalized })
        .from(users)
        .where(
          or(
            eq(users.emailNormalized, emailNormalized),
            eq(users.usernameNormalized, usernameNormalized)
          )
        )
        .limit(1);

      if (existing[0]) {
        return reply.code(409).send({ error: 'E-mail or username is already in use.' });
      }

      const passwordHash = await hashPassword(parsed.data.password);

      try {
        const user = await options.database.db.transaction(async (tx) => {
          const inserted = await tx
            .insert(users)
            .values({
              email: parsed.data.email.trim(),
              emailNormalized,
              username: usernameNormalized,
              usernameNormalized,
              displayName: parsed.data.displayName,
              passwordHash
            })
            .returning();

          const created = inserted[0];
          if (!created) throw new Error('User insert returned no row.');

          await tx.insert(userSettings).values({ userId: created.id });
          return created;
        });

        const previousToken = request.cookies[options.cookieName];
        if (previousToken) {
          const previousSessionId = await options.sessionService.destroyToken(previousToken);
          if (previousSessionId) options.realtimeEvents.emitSessionRevoked({ sessionId: previousSessionId });
        }

        const session = await options.sessionService.create(
          user.id,
          options.sessionTtlDays,
          request.headers['user-agent']
        );
        reply.setCookie(options.cookieName, session.token, {
          ...cookieBase,
          expires: session.expiresAt,
          maxAge: options.sessionTtlDays * 24 * 60 * 60
        });

        let verificationEmailSent = false;
        if (options.emailVerification?.available) {
          try {
            verificationEmailSent = (await options.emailVerification.sendCurrent(user.id)) === 'sent';
          } catch {
            // Account/session creation is durable. The user can retry from Security.
          }
        }
        return reply.code(201).send({ user: toPublicUser(user), verificationEmailSent });
      } catch (error) {
        if (isUniqueViolation(error)) {
          return reply.code(409).send({ error: 'E-mail or username is already in use.' });
        }
        throw error;
      }
    }
  );

  app.post(
    '/login',
    {
      config: {
        rateLimit: { max: 10, timeWindow: '1 minute' }
      }
    },
    async (request, reply) => {
      const parsed = loginBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Invalid login data.' });
      }

      const identifier = parsed.data.identifier.trim().toLowerCase();
      const rows = await options.database.db
        .select()
        .from(users)
        .where(or(eq(users.emailNormalized, identifier), eq(users.usernameNormalized, identifier)))
        .limit(1);

      const user = rows[0];
      if (!user || user.disabledAt) {
        return reply.code(401).send({ error: 'Invalid credentials.' });
      }

      const verification = await verifyPassword(user.passwordHash, parsed.data.password);
      if (!verification.valid) {
        return reply.code(401).send({ error: 'Invalid credentials.' });
      }

      await options.sessionService.deleteInvalid();

      // Serialize session creation with password changes on the user row. A
      // login verified against an old hash must not create a session after the
      // password-change transaction has revoked the old sessions.
      const client = await options.database.pool.connect();
      let session: Awaited<ReturnType<SessionService['create']>> | null = null;
      try {
        await client.query('begin');
        const locked = await client.query<{ password_hash: string; disabled_at: Date | null }>(
          'select password_hash, disabled_at from users where id = $1 for no key update', [user.id]
        );
        if (!locked.rows[0] || locked.rows[0].disabled_at || locked.rows[0].password_hash !== user.passwordHash) {
          await client.query('rollback');
          return reply.code(401).send({ error: 'Invalid credentials.' });
        }
        const upgradedHash = verification.needsUpgrade ? await hashPassword(parsed.data.password) : null;
        await client.query(
          'update users set last_login_at = now(), updated_at = now(), password_hash = coalesce($2, password_hash) where id = $1',
          [user.id, upgradedHash]
        );
        session = await options.sessionService.create(user.id, options.sessionTtlDays, request.headers['user-agent']);
        await client.query('commit');
      } catch (error) {
        await client.query('rollback').catch(() => {});
        if (session) await options.sessionService.destroyToken(session.token).catch(() => {});
        throw error;
      } finally {
        client.release();
      }
      if (!session) throw new Error('Session creation failed.');

      const previousToken = request.cookies[options.cookieName];
      if (previousToken) {
        try {
          const previousSessionId = await options.sessionService.destroyToken(previousToken);
          if (previousSessionId) options.realtimeEvents.emitSessionRevoked({ sessionId: previousSessionId });
        } catch (error) {
          await options.sessionService.destroyToken(session.token).catch(() => {});
          throw error;
        }
      }

      reply.setCookie(options.cookieName, session.token, {
        ...cookieBase,
        expires: session.expiresAt,
        maxAge: options.sessionTtlDays * 24 * 60 * 60
      });

      return reply.send({ user: toPublicUser(user) });
    }
  );

  app.patch('/password', {
    preHandler: requireAuth,
    config: { rateLimit: { max: 5, timeWindow: '10 minutes' } }
  }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: 'Authentication required.' });
    const parsed = passwordChangeBodySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid password change.' });

    const client = await options.database.pool.connect();
    let revokedIds: string[] = [];
    try {
      await client.query('begin');
      const user = await client.query<{ password_hash: string; disabled_at: Date | null }>(
        'select password_hash, disabled_at from users where id = $1 for no key update',
        [request.auth.user.id]
      );
      if (!user.rows[0] || user.rows[0].disabled_at) {
        await client.query('rollback');
        return reply.code(401).send({ error: 'Authentication required.' });
      }
      const session = await client.query<{ id: string }>(
        'select id from sessions where id = $1 and user_id = $2 for key share',
        [request.auth.sessionId, request.auth.user.id]
      );
      if (!session.rows[0]) {
        await client.query('rollback');
        return reply.code(401).send({ error: 'Authentication required.' });
      }
      const verification = await verifyPassword(user.rows[0].password_hash, parsed.data.currentPassword);
      if (!verification.valid) {
        await client.query('rollback');
        return reply.code(403).send({ error: 'Current password is incorrect.' });
      }

      const nextHash = await hashPassword(parsed.data.newPassword);
      await client.query('update users set password_hash = $2, updated_at = now() where id = $1',
        [request.auth.user.id, nextHash]);
      const revoked = await client.query<{ id: string }>(
        'delete from sessions where user_id = $1 and id <> $2 returning id',
        [request.auth.user.id, request.auth.sessionId]
      );
      revokedIds = revoked.rows.map((row) => row.id);
      await client.query('commit');
    } catch (error) {
      await client.query('rollback').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
    for (const sessionId of revokedIds) options.realtimeEvents.emitSessionRevoked({ sessionId });
    return reply.send({ message: 'Password changed. Other sessions were signed out.' });
  });

  app.post('/logout', async (request, reply) => {
    const token = request.cookies[options.cookieName];
    if (token) {
      const sessionId = await options.sessionService.destroyToken(token);
      if (sessionId) options.realtimeEvents.emitSessionRevoked({ sessionId });
    }

    reply.clearCookie(options.cookieName, cookieBase);
    return reply.code(204).send();
  });

  app.get('/me', { preHandler: requireAuth }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: 'Authentication required.' });
    return reply.send({ user: request.auth.user });
  });

  app.get('/sessions', { preHandler: requireAuth }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: 'Authentication required.' });

    try {
      const activeSessions = await options.sessionService.listActiveForUser(request.auth.user.id);
      const currentSessionId = request.auth.sessionId;
      activeSessions.sort((left, right) => {
        const currentOrder = Number(right.id === currentSessionId) - Number(left.id === currentSessionId);
        return currentOrder || right.lastSeenAt.getTime() - left.lastSeenAt.getTime();
      });

      return reply.send({
        sessions: activeSessions.map((session) => ({
          id: session.id,
          current: session.id === currentSessionId,
          client: session.client,
          createdAt: session.createdAt.toISOString(),
          lastSeenAt: session.lastSeenAt.toISOString(),
          expiresAt: session.expiresAt.toISOString()
        }))
      });
    } catch (error) {
      if (error instanceof SessionPersistenceError) return sessionUnavailable(reply);
      throw error;
    }
  });

  app.delete('/sessions/others', { preHandler: requireAuth }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: 'Authentication required.' });

    try {
      const deletedIds = await options.sessionService.deleteOthersForUser(
        request.auth.user.id,
        request.auth.sessionId
      );
      for (const sessionId of deletedIds) {
        options.realtimeEvents.emitSessionRevoked({ sessionId });
      }
      return reply.code(204).send();
    } catch (error) {
      if (error instanceof SessionPersistenceError) return sessionUnavailable(reply);
      throw error;
    }
  });

  app.delete('/sessions', { preHandler: requireAuth }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: 'Authentication required.' });

    try {
      const deletedIds = await options.sessionService.deleteAllForUser(request.auth.user.id);
      for (const sessionId of deletedIds) {
        options.realtimeEvents.emitSessionRevoked({ sessionId });
      }
      reply.clearCookie(options.cookieName, cookieBase);
      return reply.code(204).send();
    } catch (error) {
      if (error instanceof SessionPersistenceError) return sessionUnavailable(reply);
      throw error;
    }
  });

  app.delete('/sessions/:sessionId', { preHandler: requireAuth }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: 'Authentication required.' });
    const params = sessionParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'Invalid session id.' });

    try {
      const deletedId = await options.sessionService.deleteForUser(
        params.data.sessionId,
        request.auth.user.id
      );
      if (deletedId) {
        options.realtimeEvents.emitSessionRevoked({ sessionId: deletedId });
        if (deletedId === request.auth.sessionId) {
          reply.clearCookie(options.cookieName, cookieBase);
        }
      }
      return reply.code(204).send();
    } catch (error) {
      if (error instanceof SessionPersistenceError) return sessionUnavailable(reply);
      throw error;
    }
  });

  // Small endpoint used by the web app to validate the browser cookie after a
  // proxy/reverse-proxy change without exposing the raw session token.
  app.get('/session', async (request, reply) => {
    const token = request.cookies[options.cookieName];
    if (!token) return reply.send({ authenticated: false });

    const identity = await options.sessionService.resolveToken(token, { activity: true });
    if (!identity) {
      reply.clearCookie(options.cookieName, cookieBase);
      return reply.send({ authenticated: false });
    }

    return reply.send({ authenticated: true, user: identity.user });
  });
};
