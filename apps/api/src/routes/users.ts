import type { FastifyPluginAsync } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '@cubic/database';
import { userSettings, users } from '@cubic/database/schema';
import { createRequireAuth } from '../auth/guard.js';

const profileBodySchema = z.object({
  displayName: z.string().trim().min(1).max(64)
});

const settingsBodySchema = z
  .object({
    theme: z.enum(['dark', 'light', 'system']).optional(),
    compactMode: z.boolean().optional(),
    reduceMotion: z.boolean().optional(),
    inputVolume: z.number().int().min(0).max(100).optional(),
    outputVolume: z.number().int().min(0).max(100).optional()
  })
  .refine((value) => Object.keys(value).length > 0, 'At least one setting is required.');

export interface UserRoutesOptions {
  database: Database;
  cookieName: string;
}

export const userRoutes: FastifyPluginAsync<UserRoutesOptions> = async (app, options) => {
  const requireAuth = createRequireAuth(options.database, options.cookieName);

  app.get('/me/settings', { preHandler: requireAuth }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: 'Authentication required.' });

    const rows = await options.database.db
      .select()
      .from(userSettings)
      .where(eq(userSettings.userId, request.auth.user.id))
      .limit(1);

    const settings = rows[0];
    if (!settings) return reply.code(404).send({ error: 'User settings were not found.' });

    return reply.send({
      settings: {
        theme: settings.theme,
        compactMode: settings.compactMode,
        reduceMotion: settings.reduceMotion,
        inputVolume: settings.inputVolume,
        outputVolume: settings.outputVolume
      }
    });
  });

  app.patch('/me/settings', { preHandler: requireAuth }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: 'Authentication required.' });

    const parsed = settingsBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid settings.', fields: parsed.error.flatten().fieldErrors });
    }

    const now = new Date();
    const updated = await options.database.db
      .update(userSettings)
      .set({ ...parsed.data, updatedAt: now })
      .where(eq(userSettings.userId, request.auth.user.id))
      .returning();

    const settings = updated[0];
    if (!settings) return reply.code(404).send({ error: 'User settings were not found.' });

    return reply.send({
      settings: {
        theme: settings.theme,
        compactMode: settings.compactMode,
        reduceMotion: settings.reduceMotion,
        inputVolume: settings.inputVolume,
        outputVolume: settings.outputVolume
      }
    });
  });

  app.patch('/me/profile', { preHandler: requireAuth }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: 'Authentication required.' });

    const parsed = profileBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid profile.', fields: parsed.error.flatten().fieldErrors });
    }

    const updated = await options.database.db
      .update(users)
      .set({ displayName: parsed.data.displayName, updatedAt: new Date() })
      .where(eq(users.id, request.auth.user.id))
      .returning({ displayName: users.displayName });

    return reply.send({ displayName: updated[0]?.displayName ?? parsed.data.displayName });
  });
};
