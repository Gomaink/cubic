import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import cookie from '@fastify/cookie';
import Fastify from 'fastify';
import { Pool } from 'pg';
import type { Database } from '@cubic/database';
import type { SessionService } from '../security/session.js';
import { createRealtimeEvents } from '../realtime/events.js';
import { createOwnedServer } from '../servers/store.js';
import { serverRoutes } from './servers.js';
import type { ServerVoiceService } from '../server-voice/service.js';

const connectionString = process.env.CUBIC_SERVER_TEST_DATABASE_URL;

test('channel management uses current server permission and deletes only scoped content',
  { skip: !connectionString, timeout: 60_000 }, async () => {
    const pool = new Pool({ connectionString, max: 6 });
    const database = { pool } as Database;
    const [owner, manager, outsider] = [randomUUID(), randomUUID(), randomUUID()];
    const users = [owner, manager, outsider];
    const servers: string[] = [];
    const events = createRealtimeEvents();
    const layoutEvents: Array<{ serverId: string; deletedConversationId?: string }> = [];
    let failVoiceRevocation = false;
    events.onServerLayoutChanged((event) => layoutEvents.push(event));
    const app = Fastify({ logger: false });
    try {
      for (const [i, id] of users.entries()) await pool.query(
        `insert into users(id,email,email_normalized,username,username_normalized,display_name,password_hash)
         values($1,$2,$2,$3,$3,$4,'test-only')`,
        [id, `${id}@integration.invalid`, `manage_${i}_${id.slice(0, 8)}`, `Manager ${i}`]
      );
      const primary = await createOwnedServer(database, owner, 'Managed');
      const secondary = await createOwnedServer(database, owner, 'Other');
      servers.push(primary.id, secondary.id);
      await pool.query('insert into server_members(server_id,user_id) values($1,$2)', [primary.id, manager]);
      await app.register(cookie);
      app.decorateRequest('auth', null);
      await app.register(serverRoutes, {
        prefix: '/api/v1/servers', database, cookieName: 'session', realtimeEvents: events,
        serverVoice: { revokeDeletedChannel: async () => {
          if (failVoiceRevocation) throw new Error('temporary control plane failure');
        } } as unknown as ServerVoiceService,
        sessionService: { resolveToken: async (token: string) => {
          const id = token === 'owner' ? owner : token === 'manager' ? manager : token === 'outsider' ? outsider : null;
          return id ? { user: { id } } : null;
        } } as SessionService
      });
      const base = `/api/v1/servers/${primary.id}`;
      const other = `/api/v1/servers/${secondary.id}`;
      const send = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, actor?: string, payload?: unknown) => app.inject({
        method, url: path, headers: actor ? { cookie: `session=${actor}` } : {},
        ...(payload === undefined ? {} : { payload: JSON.stringify(payload), headers: { ...(actor ? { cookie: `session=${actor}` } : {}), 'content-type': 'application/json' } })
      });
      assert.equal((await send('GET', `${base}/channel-management`)).statusCode, 401);
      assert.equal((await send('GET', `${base}/channel-management`, 'outsider')).statusCode, 404);
      assert.equal((await send('GET', `${base}/channel-management`, 'manager')).statusCode, 403);
      assert.equal((await send('POST', `${base}/channels`, 'manager', { name: 'no' })).statusCode, 403);
      assert.equal((await send('POST', `${base}/voice-channels`, 'manager', { name: 'no' })).statusCode, 403);
      assert.equal((await send('POST', `${base}/categories`, 'manager', { name: 'no' })).statusCode, 403);
      assert.equal((await send('GET', `${base}/channel-management`, 'owner')).json().canManageChannels, true);

      // Default role grants all members the management bit, then a custom role grants only the manager.
      await pool.query('update server_roles set permissions = permissions | 8 where id = $1', [primary.id]);
      assert.equal((await send('POST', `${base}/categories`, 'manager', { name: 'Default' })).statusCode, 201);
      await pool.query('update server_roles set permissions = permissions & ~8 where id = $1', [primary.id]);
      assert.equal((await send('POST', `${base}/categories`, 'manager', { name: 'Denied' })).statusCode, 403);
      const role = (await pool.query<{ id: string }>(
        `insert into server_roles(server_id,name,position,permissions) values($1,'Channels',1,8) returning id`, [primary.id]
      )).rows[0]!;
      await pool.query('insert into server_member_roles(server_id,user_id,role_id) values($1,$2,$3)', [primary.id, manager, role.id]);
      const category = (await send('POST', `${base}/categories`, 'manager', { name: 'Managed' })).json().category;
      const foreignCategory = (await send('POST', `${other}/categories`, 'owner', { name: 'Foreign' })).json().category;
      assert.equal((await send('POST', `${base}/channels`, 'manager', { name: 'Invalid', categoryId: foreignCategory.id })).statusCode, 404);
      const channel = (await send('POST', `${base}/channels`, 'manager', { name: 'History', categoryId: category.id })).json().channel;
      const survivor = (await send('POST', `${base}/channels`, 'owner', { name: 'Survivor' })).json().channel;
      const foreign = (await send('POST', `${other}/channels`, 'owner', { name: 'Foreign' })).json().channel;
      assert.equal((await send('PATCH', `${base}/channels/${foreign.id}`, 'manager', { name: 'No' })).statusCode, 404);
      assert.equal((await send('DELETE', `${base}/channels/${foreign.id}`, 'manager')).statusCode, 404);
      assert.equal((await send('POST', `${base}/layout/text/${foreign.id}/move`, 'manager', { targetCategoryId: null, targetIndex: 0 })).statusCode, 404);
      assert.equal((await send('POST', `${base}/layout/text/${channel.id}/move`, 'manager', { targetCategoryId: foreignCategory.id, targetIndex: 0 })).statusCode, 404);
      assert.equal((await send('PATCH', `${base}/channels/${channel.id}`, 'manager', { name: 'Renamed' })).json().channel.name, 'Renamed');
      const message = (await pool.query<{ id: string }>(
        `insert into messages(conversation_id,sender_id,client_message_id,body) values($1,$2,$3,'Keep until deletion') returning id`,
        [channel.conversationId, owner, randomUUID()]
      )).rows[0]!;
      assert.equal((await pool.query('select body from messages where id = $1', [message.id])).rows[0].body, 'Keep until deletion');
      const attachment = randomUUID();
      const storageKey = randomUUID();
      await pool.query(`insert into attachments(id,conversation_id,uploader_id,message_id,storage_key,original_name,content_type,size_bytes)
        values($1,$2,$3,$4,$5,'history.txt','text/plain',4)`, [attachment, channel.conversationId, owner, message.id, storageKey]);
      const managed = (await send('GET', `${base}/channel-management`, 'manager')).json();
      assert.equal(managed.channels.some((item: { id: string }) => item.id === channel.id), true);
      assert.equal(JSON.stringify(managed).includes('Keep until deletion'), false);
      await pool.query(`insert into server_channel_overrides(server_id,text_channel_id,member_user_id,deny)
        values($1,$2,$3,4096)`, [primary.id, channel.id, manager]);
      assert.equal((await send('GET', `${base}/channels`, 'manager')).json().channels.some((item: { id: string }) => item.id === channel.id), false);
      assert.equal((await send('GET', `${base}/channel-management`, 'manager')).json().channels.some((item: { id: string }) => item.id === channel.id), true);
      assert.equal((await send('DELETE', `${base}/channels/${channel.id}`, 'manager')).statusCode, 204);
      assert.equal(layoutEvents.at(-1)?.deletedConversationId, channel.conversationId);
      assert.equal((await pool.query('select 1 from server_text_channels where id = $1', [channel.id])).rowCount, 0);
      assert.equal((await pool.query('select 1 from conversations where id = $1', [channel.conversationId])).rowCount, 0);
      assert.equal((await pool.query('select 1 from attachments where id = $1', [attachment])).rowCount, 0);
      assert.equal((await pool.query('select 1 from attachment_file_deletions where storage_key = $1', [storageKey])).rowCount, 1);
      assert.equal((await pool.query('select 1 from conversations where id = $1', [survivor.conversationId])).rowCount, 1);
      assert.equal((await pool.query('select 1 from conversations where id = $1', [foreign.conversationId])).rowCount, 1);
      const voice = (await send('POST', `${base}/voice-channels`, 'manager', { name: 'Call', categoryId: category.id })).json().channel;
      assert.equal((await send('PATCH', `${base}/voice-channels/${voice.id}`, 'manager', { name: 'Renamed call' })).statusCode, 200);
      assert.equal((await send('DELETE', `${base}/voice-channels/${voice.id}`, 'manager')).statusCode, 204);
      assert.equal((await pool.query('select 1 from server_voice_channels where id = $1', [voice.id])).rowCount, 0);
      const pendingVoice = (await send('POST', `${base}/voice-channels`, 'manager', { name: 'Pending' })).json().channel;
      failVoiceRevocation = true;
      const pendingDelete = await send('DELETE', `${base}/voice-channels/${pendingVoice.id}`, 'manager');
      assert.equal(pendingDelete.statusCode, 200);
      assert.deepEqual(pendingDelete.json(), { deleted: true, voiceRevocationPending: true });
      assert.equal((await pool.query('select 1 from server_voice_channels where id = $1', [pendingVoice.id])).rowCount, 0);
      failVoiceRevocation = false;
      assert.equal((await send('PATCH', `${base}/categories/${category.id}`, 'manager', { name: 'New name' })).statusCode, 200);
      assert.equal((await send('POST', `${base}/categories/${category.id}/move`, 'manager', { targetIndex: 0 })).statusCode, 200);
      assert.equal((await send('DELETE', `${base}/categories/${category.id}`, 'manager')).statusCode, 204);
      const blocker = await pool.connect();
      try {
        await blocker.query('begin');
        await blocker.query('select id from servers where id = $1 for update', [primary.id]);
        const pending = send('POST', `${base}/channels`, 'manager', { name: 'Stale grant' });
        await new Promise((resolve) => setTimeout(resolve, 50));
        await blocker.query('delete from server_member_roles where server_id = $1 and user_id = $2', [primary.id, manager]);
        await blocker.query('commit');
        const eventCount = layoutEvents.length;
        assert.equal((await pending).statusCode, 403);
        assert.equal(layoutEvents.length, eventCount);
        assert.equal((await pool.query("select 1 from server_text_channels where server_id = $1 and name = 'Stale grant'", [primary.id])).rowCount, 0);
      } finally {
        await blocker.query('rollback').catch(() => {});
        blocker.release();
      }
      assert.equal((await send('POST', `${base}/channels`, 'manager', { name: 'Revoked' })).statusCode, 403);
      await pool.query('delete from server_members where server_id = $1 and user_id = $2', [primary.id, manager]);
      assert.equal((await send('POST', `${base}/channels`, 'manager', { name: 'Outsider' })).statusCode, 404);
    } finally {
      await app.close();
      await pool.query('delete from servers where id = any($1::uuid[])', [servers]).catch(() => {});
      await pool.query('delete from users where id = any($1::uuid[])', [users]).catch(() => {});
      await pool.end();
    }
  });
