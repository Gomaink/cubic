import type { FastifyPluginAsync } from 'fastify';
import { eq, or } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '@cubic/database';
import { userSettings, users } from '@cubic/database/schema';
import { normalizeEmail, normalizeUsername, toPublicUser } from '../auth/identity.js';
import { createRequireAuth } from '../auth/guard.js';
import { hashPassword, verifyPassword } from '../security/password.js';
import {
  createSession,
  deleteExpiredSessions,
  destroySession,
  resolveSession
} from '../security/session.js';

const registerBodySchema = z.object({
  email: z.string().trim().email().max(254),
  username: z
    .string()
    .trim()
    .min(3)
    .max(32)
    .regex(/^[A-Za-z0-9_]+$/, 'Username may only contain letters, numbers and underscores.'),
  displayName: z.string().trim().min(1).max(64),
  password: z.string().min(10).max(128)
});

const loginBodySchema = z.object({
  identifier: z.string().trim().min(1).max(254),
  password: z.string().min(1).max(128)
});

export interface AuthRoutesOptions {
  database: Database;
  cookieName: string;
  cookieSecure: boolean;
  sessionTtlDays: number;
  registrationEnabled: boolean;
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
  const requireAuth = createRequireAuth(options.database, options.cookieName);
  const cookieBase = {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: options.cookieSecure,
    path: '/'
  };

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
        if (previousToken) await destroySession(options.database, previousToken);

        const session = await createSession(options.database, user.id, options.sessionTtlDays);
        reply.setCookie(options.cookieName, session.token, {
          ...cookieBase,
          expires: session.expiresAt,
          maxAge: options.sessionTtlDays * 24 * 60 * 60
        });

        return reply.code(201).send({ user: toPublicUser(user) });
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

      const now = new Date();
      const updates: Partial<typeof users.$inferInsert> = { lastLoginAt: now, updatedAt: now };
      if (verification.needsUpgrade) {
        updates.passwordHash = await hashPassword(parsed.data.password);
      }

      await options.database.db.update(users).set(updates).where(eq(users.id, user.id));
      await deleteExpiredSessions(options.database);

      const previousToken = request.cookies[options.cookieName];
      if (previousToken) await destroySession(options.database, previousToken);

      const session = await createSession(options.database, user.id, options.sessionTtlDays);
      reply.setCookie(options.cookieName, session.token, {
        ...cookieBase,
        expires: session.expiresAt,
        maxAge: options.sessionTtlDays * 24 * 60 * 60
      });

      return reply.send({ user: toPublicUser(user) });
    }
  );

  app.post('/logout', async (request, reply) => {
    const token = request.cookies[options.cookieName];
    if (token) await destroySession(options.database, token);

    reply.clearCookie(options.cookieName, cookieBase);
    return reply.code(204).send();
  });

  app.get('/me', { preHandler: requireAuth }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: 'Authentication required.' });
    return reply.send({ user: request.auth.user });
  });

  // Small endpoint used by the web app to validate the browser cookie after a
  // proxy/reverse-proxy change without exposing the raw session token.
  app.get('/session', async (request, reply) => {
    const token = request.cookies[options.cookieName];
    if (!token) return reply.send({ authenticated: false });

    const identity = await resolveSession(options.database, token);
    if (!identity) return reply.send({ authenticated: false });

    return reply.send({ authenticated: true, user: identity.user });
  });
};
