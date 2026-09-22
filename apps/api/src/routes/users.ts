import type { FastifyPluginAsync } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '@cubic/database';
import { userSettings, users } from '@cubic/database/schema';
import { createRequireAuth } from '../auth/guard.js';
import type { SessionService } from '../security/session.js';
import type { LocalMediaStore } from '../media/local.js';
import { mediaInternals } from '../media/local.js';
import { managedUserAvatarKey, managedUserAvatarUrl, normalizeLegacyAvatarUrl } from '../auth/identity.js';
import type { RealtimeEvents, ProfileChangedEvent } from '../realtime/events.js';

const profileBodySchema = z.object({
  displayName: z.string().trim().min(1).max(64)
});
const avatarParamsSchema = z.object({ id: z.string().uuid(), key: z.string() });

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
  sessionService: SessionService;
  mediaStore: LocalMediaStore;
  avatarMaxBytes: number;
  realtimeEvents?: RealtimeEvents;
}

export const userRoutes: FastifyPluginAsync<UserRoutesOptions> = async (app, options) => {
  const requireAuth = createRequireAuth(options.sessionService, options.cookieName);

  async function updateAvatar(userId: string, avatarUrl: string | null): Promise<{ previousUrl: string | null; profile: ProfileChangedEvent } | null> {
    const client = await options.database.pool.connect();
    try {
      await client.query('begin');
      const current = await client.query<{ avatar_url: string | null }>(
        'select avatar_url from users where id = $1 for update', [userId]
      );
      if (!current.rows[0]) {
        await client.query('rollback');
        return null;
      }
      const updated = await client.query<{ display_name: string; avatar_url: string | null }>(
        'update users set avatar_url = $2, updated_at = now() where id = $1 returning display_name, avatar_url',
        [userId, avatarUrl]
      );
      const row = updated.rows[0];
      if (!row) throw new Error('User avatar update failed.');
      await client.query('commit');
      return {
        previousUrl: current.rows[0].avatar_url,
        profile: { userId, displayName: row.display_name, avatarUrl: normalizeLegacyAvatarUrl(row.avatar_url) }
      };
    } catch (error) {
      await client.query('rollback').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async function deletePreviousAvatar(userId: string, previousUrl: string | null): Promise<void> {
    await options.mediaStore.deleteUserAvatar(managedUserAvatarKey(previousUrl, userId)).catch(() => {});
  }

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
      .returning({ displayName: users.displayName, avatarUrl: users.avatarUrl });

    if (!updated[0]) return reply.code(404).send({ error: 'User not found.' });
    options.realtimeEvents?.emitProfileChanged({
      userId: request.auth.user.id,
      displayName: updated[0].displayName,
      avatarUrl: normalizeLegacyAvatarUrl(updated[0].avatarUrl)
    });
    return reply.send({ displayName: updated[0].displayName });
  });

  app.get('/:id/avatar/:key', { preHandler: requireAuth }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: 'Authentication required.' });
    const params = avatarParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(404).send({ error: 'Avatar not found.' });
    let url: string;
    try { url = managedUserAvatarUrl(params.data.id, params.data.key); }
    catch { return reply.code(404).send({ error: 'Avatar not found.' }); }
    const current = await options.database.pool.query<{ avatar_url: string | null }>(
      'select avatar_url from users where id = $1 and avatar_url = $2 limit 1',
      [params.data.id, url]
    );
    if (!current.rows[0]) return reply.code(404).send({ error: 'Avatar not found.' });
    try {
      const media = await options.mediaStore.readUserAvatar(params.data.key);
      reply.header('cache-control', 'private, max-age=86400, immutable');
      reply.header('x-content-type-options', 'nosniff');
      reply.header('content-disposition', `inline; filename="user-avatar.${params.data.key.split('.').at(-1)}"`);
      return reply.type(media.contentType).send(media.buffer);
    } catch {
      return reply.code(404).send({ error: 'Avatar not found.' });
    }
  });

  app.post('/me/avatar', { preHandler: requireAuth }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: 'Authentication required.' });
    const userId = request.auth.user.id;
    const part = await request.file({ limits: { fileSize: options.avatarMaxBytes } }).catch(() => null);
    if (!part || part.fieldname !== 'avatar') return reply.code(400).send({ error: 'Choose a PNG, JPEG, WebP or GIF avatar up to 2 MB.' });
    let buffer: Buffer;
    try { buffer = await part.toBuffer(); }
    catch { return reply.code(413).send({ error: 'Avatar is too large.' }); }
    if (part.file.truncated || buffer.length > options.avatarMaxBytes) return reply.code(413).send({ error: 'Avatar is too large.' });
    if (!mediaInternals.detectUserImage(buffer)) return reply.code(415).send({ error: 'Use a PNG, JPEG, WebP or GIF image.' });

    const stored = await options.mediaStore.saveUserAvatar(buffer);
    const avatarUrl = managedUserAvatarUrl(userId, stored.key);
    let result;
    try { result = await updateAvatar(userId, avatarUrl); }
    catch (error) {
      await options.mediaStore.deleteUserAvatar(stored.key).catch(() => {});
      throw error;
    }
    if (!result) {
      await options.mediaStore.deleteUserAvatar(stored.key).catch(() => {});
      return reply.code(404).send({ error: 'User not found.' });
    }
    await deletePreviousAvatar(userId, result.previousUrl);
    options.realtimeEvents?.emitProfileChanged(result.profile);
    return reply.send({ profile: result.profile });
  });

  app.delete('/me/avatar', { preHandler: requireAuth }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: 'Authentication required.' });
    const result = await updateAvatar(request.auth.user.id, null);
    if (!result) return reply.code(404).send({ error: 'User not found.' });
    await deletePreviousAvatar(request.auth.user.id, result.previousUrl);
    options.realtimeEvents?.emitProfileChanged(result.profile);
    return reply.send({ profile: result.profile });
  });
};
