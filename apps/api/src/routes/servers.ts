import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { Database } from '@cubic/database';
import { createRequireAuth } from '../auth/guard.js';
import type { SessionService } from '../security/session.js';
import { createOwnedServer, listMemberServers, resolveMemberServer } from '../servers/store.js';
import { createOwnedTextChannel, listMemberTextChannels } from '../servers/channels.js';
import { createCategory, deleteCategory, listMemberCategories, moveCategory, moveChannel, renameCategory } from '../servers/layout.js';
import {
  acceptServerInvite, cancelServerInvite, createServerInvite, leaveServer, removeServerMember,
  listOwnedServerInvites, listReceivedServerInvites, listServerMembers
} from '../servers/invites.js';
import type { RealtimeEvents } from '../realtime/events.js';
import { createServerInviteLink, listOwnedServerInviteLinks, revokeServerInviteLink } from '../servers/invite-links.js';
import { ServerIconStore, SERVER_ICON_MAX_BYTES, InvalidServerIconError } from '../server-icons/storage.js';
import { checkIconOwner, replaceServerIcon, removeServerIcon } from '../server-icons/service.js';

export interface ServerRoutesOptions {
  database: Database;
  cookieName: string;
  sessionService: SessionService;
  realtimeEvents?: RealtimeEvents;
  iconStore?: ServerIconStore;
}

const createServerSchema = z.object({ name: z.string().trim().min(1).max(96) });
const serverParamsSchema = z.object({ serverId: z.string().uuid() });
const createChannelSchema = z.object({ name: z.string().trim().min(1).max(96), categoryId: z.string().uuid().nullable().optional() });
const categoryNameSchema = z.object({ name: z.string().trim().min(1).max(96) });
const categoryParamsSchema = serverParamsSchema.extend({ categoryId: z.string().uuid() });
const channelParamsSchema = serverParamsSchema.extend({ channelId: z.string().uuid() });
const moveCategorySchema = z.object({ targetIndex: z.number().int().nonnegative() });
const moveChannelSchema = z.object({ targetCategoryId: z.string().uuid().nullable(), targetIndex: z.number().int().nonnegative() });
const inviteParamsSchema = z.object({ inviteId: z.string().uuid() });
const inviteTargetSchema = z.object({ userId: z.string().uuid() });
const memberParamsSchema = serverParamsSchema.extend({ userId: z.string().uuid() });
const inviteLinkParamsSchema = serverParamsSchema.extend({ linkId: z.string().uuid() });

export const serverRoutes: FastifyPluginAsync<ServerRoutesOptions> = async (app, options) => {
  const requireAuth = createRequireAuth(options.sessionService, options.cookieName);
  const revokeChannelRooms = (conversationIds: string[], userId: string) => {
    for (const conversationId of conversationIds) {
      options.realtimeEvents?.emitConversationRemoved({ conversationId, removedUserIds: [userId], remainingUserIds: [] });
    }
  };

  app.post('/', { preHandler: requireAuth }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: 'Authentication required.' });
    const parsed = createServerSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid server name.' });

    const server = await createOwnedServer(options.database, request.auth.user.id, parsed.data.name);
    return reply.code(201).send({ server });
  });

  app.get('/', { preHandler: requireAuth }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: 'Authentication required.' });
    return { servers: await listMemberServers(options.database, request.auth.user.id) };
  });

  app.get('/:serverId', { preHandler: requireAuth }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: 'Authentication required.' });
    const params = serverParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'Invalid server.' });
    const server = await resolveMemberServer(options.database, params.data.serverId, request.auth.user.id);
    if (!server) return reply.code(404).send({ error: 'Server not found.' });
    return { server };
  });

  app.get('/:serverId/icon', { preHandler: requireAuth }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: 'Authentication required.' });
    const params = serverParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'Invalid server.' });
    if (!options.iconStore) return reply.code(404).send({ error: 'Server icon not found.' });
    const key = await options.database.pool.query<{ icon_key: string | null }>(
      `select s.icon_key from servers s
         join server_members m on m.server_id = s.id and m.user_id = $2
        where s.id = $1`, [params.data.serverId, request.auth.user.id]
    );
    if (!key.rows[0]?.icon_key) return reply.code(404).send({ error: 'Server icon not found.' });
    try {
      const bytes = await options.iconStore.read(key.rows[0].icon_key);
      reply.header('cache-control', 'private, no-store');
      reply.header('content-disposition', 'inline; filename="server-icon.webp"');
      return reply.type('image/webp').send(bytes);
    } catch { return reply.code(404).send({ error: 'Server icon not found.' }); }
  });

  app.put('/:serverId/icon', { preHandler: requireAuth, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: 'Authentication required.' });
    const params = serverParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'Invalid server.' });
    if (!options.iconStore) return reply.code(503).send({ error: 'Server icons unavailable.' });
    const preflight = await checkIconOwner(options.database, params.data.serverId, request.auth.user.id);
    if (preflight !== true) return reply.code(preflight.denied === 'not_owner' ? 403 : 404).send({ error: 'Server not found or icon management denied.' });
    const part = await request.file({ limits: { files: 1, fileSize: SERVER_ICON_MAX_BYTES + 1 } }).catch(() => null);
    if (!part || part.fieldname !== 'icon') return reply.code(400).send({ error: 'Choose one server icon.' });
    let input: Buffer;
    try { input = await part.toBuffer(); }
    catch { return reply.code(413).send({ error: 'Server icon is too large.' }); }
    if (part.file.truncated || input.length > SERVER_ICON_MAX_BYTES) return reply.code(413).send({ error: 'Server icon is too large.' });
    let result;
    try {
      result = await replaceServerIcon({ database: options.database, store: options.iconStore, serverId: params.data.serverId,
        actorId: request.auth.user.id, input, logger: app.log });
    } catch (error) {
      if (error instanceof InvalidServerIconError) return reply.code(415).send({ error: 'Use a valid JPEG, PNG or WebP image.' });
      throw error;
    }
    if (result !== true) return reply.code(result.denied === 'not_owner' ? 403 : 404).send({ error: 'Server not found or icon management denied.' });
    const server = await resolveMemberServer(options.database, params.data.serverId, request.auth.user.id);
    return { server };
  });

  app.delete('/:serverId/icon', { preHandler: requireAuth }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: 'Authentication required.' });
    const params = serverParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'Invalid server.' });
    if (!options.iconStore) return reply.code(503).send({ error: 'Server icons unavailable.' });
    const result = await removeServerIcon({ database: options.database, store: options.iconStore,
      serverId: params.data.serverId, actorId: request.auth.user.id, logger: app.log });
    if (result !== true) return reply.code(result.denied === 'not_owner' ? 403 : 404).send({ error: 'Server not found or icon management denied.' });
    const server = await resolveMemberServer(options.database, params.data.serverId, request.auth.user.id);
    return { server };
  });

  app.get('/:serverId/channels', { preHandler: requireAuth }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: 'Authentication required.' });
    const params = serverParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'Invalid server.' });
    const server = await resolveMemberServer(options.database, params.data.serverId, request.auth.user.id);
    if (!server) return reply.code(404).send({ error: 'Server not found.' });
    return { channels: await listMemberTextChannels(options.database, server.id, request.auth.user.id) };
  });

  app.post('/:serverId/channels', { preHandler: requireAuth }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: 'Authentication required.' });
    const params = serverParamsSchema.safeParse(request.params);
    const body = createChannelSchema.safeParse(request.body);
    if (!params.success) return reply.code(400).send({ error: 'Invalid server.' });
    if (!body.success) return reply.code(400).send({ error: 'Invalid channel name.' });
    const result = await createOwnedTextChannel(
      options.database,
      params.data.serverId,
      request.auth.user.id,
      body.data.name,
      body.data.categoryId ?? null
    );
    if ('denied' in result) {
      return result.denied === 'not_found'
        ? reply.code(404).send({ error: 'Server not found.' })
        : reply.code(403).send({ error: 'Only the server owner can create channels.' });
    }
    return reply.code(201).send({ channel: result.channel });
  });

  app.get('/:serverId/categories', { preHandler: requireAuth }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: 'Authentication required.' });
    const params = serverParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'Invalid server.' });
    const result = await listMemberCategories(options.database, params.data.serverId, request.auth.user.id);
    if ('denied' in result) return reply.code(404).send({ error: 'Server not found.' });
    return { categories: result };
  });

  app.post('/:serverId/categories', { preHandler: requireAuth }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: 'Authentication required.' });
    const params = serverParamsSchema.safeParse(request.params);
    const body = categoryNameSchema.safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: 'Invalid category.' });
    const result = await createCategory(options.database, params.data.serverId, request.auth.user.id, body.data.name);
    if ('denied' in result) return reply.code(result.denied === 'not_owner' ? 403 : 404).send({ error: result.denied === 'not_owner' ? 'Only the server owner can manage categories.' : 'Server not found.' });
    return reply.code(201).send(result);
  });

  app.patch('/:serverId/categories/:categoryId', { preHandler: requireAuth }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: 'Authentication required.' });
    const params = categoryParamsSchema.safeParse(request.params);
    const body = categoryNameSchema.safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: 'Invalid category.' });
    const result = await renameCategory(options.database, params.data.serverId, request.auth.user.id, params.data.categoryId, body.data.name);
    if ('denied' in result) return reply.code(result.denied === 'not_owner' ? 403 : 404).send({ error: result.denied === 'not_owner' ? 'Only the server owner can manage categories.' : 'Category not found.' });
    return result;
  });

  app.delete('/:serverId/categories/:categoryId', { preHandler: requireAuth }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: 'Authentication required.' });
    const params = categoryParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'Invalid category.' });
    const result = await deleteCategory(options.database, params.data.serverId, request.auth.user.id, params.data.categoryId);
    if ('denied' in result) return reply.code(result.denied === 'not_owner' ? 403 : 404).send({ error: result.denied === 'not_owner' ? 'Only the server owner can manage categories.' : 'Category not found.' });
    return reply.code(204).send();
  });

  app.post('/:serverId/categories/:categoryId/move', { preHandler: requireAuth }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: 'Authentication required.' });
    const params = categoryParamsSchema.safeParse(request.params);
    const body = moveCategorySchema.safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: 'Invalid category move.' });
    const result = await moveCategory(options.database, params.data.serverId, request.auth.user.id, params.data.categoryId, body.data.targetIndex);
    if ('denied' in result) return reply.code(result.denied === 'invalid_index' ? 400 : result.denied === 'not_owner' ? 403 : 404).send({ error: 'Category move not allowed.' });
    return result;
  });

  app.post('/:serverId/channels/:channelId/move', { preHandler: requireAuth }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: 'Authentication required.' });
    const params = channelParamsSchema.safeParse(request.params);
    const body = moveChannelSchema.safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: 'Invalid channel move.' });
    const result = await moveChannel(options.database, params.data.serverId, request.auth.user.id, params.data.channelId, body.data.targetCategoryId, body.data.targetIndex);
    if ('denied' in result) return reply.code(result.denied === 'invalid_index' ? 400 : result.denied === 'not_owner' ? 403 : 404).send({ error: 'Channel move not allowed.' });
    return result;
  });

  app.get('/invites', { preHandler: requireAuth }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: 'Authentication required.' });
    return { invites: await listReceivedServerInvites(options.database, request.auth.user.id) };
  });

  app.get('/:serverId/invites', { preHandler: requireAuth }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: 'Authentication required.' });
    const params = serverParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'Invalid server.' });
    const result = await listOwnedServerInvites(options.database, params.data.serverId, request.auth.user.id);
    if ('denied' in result) return reply.code(404).send({ error: 'Server not found.' });
    return { invites: result.value };
  });

  app.post('/:serverId/invite-links', { preHandler: requireAuth, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: 'Authentication required.' });
    const params = serverParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'Invalid server.' });
    const result = await createServerInviteLink(options.database, params.data.serverId, request.auth.user.id);
    if ('denied' in result) return reply.code(result.denied === 'not_owner' ? 403 : 404).send({ error: result.denied === 'not_owner' ? 'Only the server owner can create invite links.' : 'Server not found.' });
    reply.header('cache-control', 'no-store');
    return reply.code(201).send(result.value);
  });

  app.get('/:serverId/invite-links', { preHandler: requireAuth }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: 'Authentication required.' });
    const params = serverParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'Invalid server.' });
    const result = await listOwnedServerInviteLinks(options.database, params.data.serverId, request.auth.user.id);
    if ('denied' in result) return reply.code(404).send({ error: 'Server not found.' });
    reply.header('cache-control', 'no-store');
    return { inviteLinks: result.value };
  });

  app.post('/:serverId/invite-links/:linkId/revoke', { preHandler: requireAuth }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: 'Authentication required.' });
    const params = inviteLinkParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'Invalid invite link.' });
    const result = await revokeServerInviteLink(options.database, params.data.serverId, params.data.linkId, request.auth.user.id);
    if ('denied' in result) return reply.code(result.denied === 'not_owner' ? 403 : 404).send({ error: result.denied === 'not_owner' ? 'Only the server owner can revoke invite links.' : 'Invite link not found.' });
    reply.header('cache-control', 'no-store');
    return { inviteLink: result.value };
  });

  app.get('/:serverId/members', { preHandler: requireAuth }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: 'Authentication required.' });
    const params = serverParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'Invalid server.' });
    const result = await listServerMembers(options.database, params.data.serverId, request.auth.user.id);
    if ('denied' in result) return reply.code(404).send({ error: 'Server not found.' });
    return { members: result.value };
  });

  app.delete('/:serverId/members/:userId', { preHandler: requireAuth }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: 'Authentication required.' });
    const params = memberParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'Invalid server member.' });
    const result = await removeServerMember(options.database, params.data.serverId, request.auth.user.id, params.data.userId);
    if ('denied' in result) {
      if (result.denied === 'not_owner') return reply.code(403).send({ error: 'Only the server owner can remove members.' });
      if (result.denied === 'owner') return reply.code(403).send({ error: 'The server owner cannot be removed.' });
      return reply.code(404).send({ error: 'Server member not found.' });
    }
    revokeChannelRooms(result.value, params.data.userId);
    return reply.code(204).send();
  });

  app.post('/:serverId/invites', { preHandler: requireAuth }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: 'Authentication required.' });
    const params = serverParamsSchema.safeParse(request.params);
    const body = inviteTargetSchema.safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: 'Invalid invitation.' });
    const result = await createServerInvite(options.database, params.data.serverId, request.auth.user.id, body.data.userId);
    if ('denied' in result) {
      if (result.denied === 'not_found') return reply.code(404).send({ error: 'Server not found.' });
      if (result.denied === 'not_owner') return reply.code(403).send({ error: 'Only the server owner can invite friends.' });
      if (result.denied === 'not_friend') return reply.code(403).send({ error: 'You can only invite available friends.' });
      return reply.code(409).send({ error: result.denied === 'member' ? 'User is already a server member.' : 'An invitation is already pending.' });
    }
    return reply.code(201).send({ invite: result.value });
  });

  app.post('/invites/:inviteId/accept', { preHandler: requireAuth }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: 'Authentication required.' });
    const params = inviteParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'Invalid invitation.' });
    const result = await acceptServerInvite(options.database, params.data.inviteId, request.auth.user.id);
    if ('denied' in result) return reply.code(result.denied === 'member' ? 409 : 404).send({ error: result.denied === 'member' ? 'Already a server member.' : 'Invitation not found.' });
    const server = await resolveMemberServer(options.database, result.value, request.auth.user.id);
    if (!server) return reply.code(409).send({ error: 'Server membership changed. Refresh and try again.' });
    return reply.send({ server });
  });

  app.delete('/invites/:inviteId', { preHandler: requireAuth }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: 'Authentication required.' });
    const params = inviteParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'Invalid invitation.' });
    const result = await cancelServerInvite(options.database, params.data.inviteId, request.auth.user.id);
    if ('denied' in result) return reply.code(404).send({ error: 'Invitation not found.' });
    return reply.code(204).send();
  });

  app.post('/:serverId/leave', { preHandler: requireAuth }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: 'Authentication required.' });
    const params = serverParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'Invalid server.' });
    const actorId = request.auth.user.id;
    const result = await leaveServer(options.database, params.data.serverId, actorId);
    if ('denied' in result) return reply.code(result.denied === 'owner' ? 403 : 404).send({ error: result.denied === 'owner' ? 'The server owner cannot leave.' : 'Server not found.' });
    revokeChannelRooms(result.value, actorId);
    return reply.code(204).send();
  });
};
