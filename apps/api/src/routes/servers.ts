import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { Database } from '@cubic/database';
import { createRequireAuth } from '../auth/guard.js';
import type { SessionService } from '../security/session.js';
import { createOwnedServer, listMemberServers, resolveMemberServer } from '../servers/store.js';
import { createOwnedTextChannel, listMemberTextChannels } from '../servers/channels.js';

export interface ServerRoutesOptions {
  database: Database;
  cookieName: string;
  sessionService: SessionService;
}

const createServerSchema = z.object({ name: z.string().trim().min(1).max(96) });
const serverParamsSchema = z.object({ serverId: z.string().uuid() });
const createChannelSchema = z.object({ name: z.string().trim().min(1).max(96) });

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
};
