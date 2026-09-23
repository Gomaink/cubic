import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { Database } from '@cubic/database';
import { createRequireAuth } from '../auth/guard.js';
import type { SessionService } from '../security/session.js';
import { createOwnedServer, listMemberServers, resolveMemberServer } from '../servers/store.js';
import { createOwnedTextChannel, listMemberTextChannels } from '../servers/channels.js';
import {
  acceptServerInvite, cancelServerInvite, createServerInvite, leaveServer,
  listOwnedServerInvites, listReceivedServerInvites, listServerMembers
} from '../servers/invites.js';
import type { RealtimeEvents } from '../realtime/events.js';

export interface ServerRoutesOptions {
  database: Database;
  cookieName: string;
  sessionService: SessionService;
  realtimeEvents?: RealtimeEvents;
}

const createServerSchema = z.object({ name: z.string().trim().min(1).max(96) });
const serverParamsSchema = z.object({ serverId: z.string().uuid() });
const createChannelSchema = z.object({ name: z.string().trim().min(1).max(96) });
const inviteParamsSchema = z.object({ inviteId: z.string().uuid() });
const inviteTargetSchema = z.object({ userId: z.string().uuid() });

export const serverRoutes: FastifyPluginAsync<ServerRoutesOptions> = async (app, options) => {
  const requireAuth = createRequireAuth(options.sessionService, options.cookieName);

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
      body.data.name
    );
    if ('denied' in result) {
      return result.denied === 'not_found'
        ? reply.code(404).send({ error: 'Server not found.' })
        : reply.code(403).send({ error: 'Only the server owner can create channels.' });
    }
    return reply.code(201).send({ channel: result.channel });
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

  app.get('/:serverId/members', { preHandler: requireAuth }, async (request, reply) => {
    if (!request.auth) return reply.code(401).send({ error: 'Authentication required.' });
    const params = serverParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'Invalid server.' });
    const result = await listServerMembers(options.database, params.data.serverId, request.auth.user.id);
    if ('denied' in result) return reply.code(404).send({ error: 'Server not found.' });
    return { members: result.value };
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
    for (const conversationId of result.value) {
      options.realtimeEvents?.emitConversationRemoved({ conversationId, removedUserIds: [actorId], remainingUserIds: [] });
    }
    return reply.code(204).send();
  });
};
