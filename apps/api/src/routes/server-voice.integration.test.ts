import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { TokenVerifier } from 'livekit-server-sdk';
import type { Database } from '@cubic/database';
import type { SessionService } from '../security/session.js';
import { createRealtimeEvents } from '../realtime/events.js';
import { ServerVoiceDeniedError, ServerVoiceService } from '../server-voice/service.js';
import { serverVoiceRoomName } from '../server-voice/token.js';
import { serverRoutes } from './servers.js';
import { serverVoiceRoutes } from './server-voice.js';

const connectionString = process.env.CUBIC_SERVER_TEST_DATABASE_URL ?? process.env.CUBIC_GROUP_TEST_DATABASE_URL;
const apiKey = 'INTEGRATION_TEST_KEY';
const apiSecret = 'integration-test-secret-longer-than-thirty-two-characters';

test('server voice management, mixed order, admission and member revocation use one server authority',
  { skip: !connectionString, timeout: 60_000 }, async () => {
    const pool = new Pool({ connectionString, max: 8 });
    const database = { pool, db: drizzle(pool) } as unknown as Database;
    const ownerId = randomUUID(), memberId = randomUUID(), outsiderId = randomUUID();
    const serverId = randomUUID(), otherServerId = randomUUID();
    const suffix = ownerId.replaceAll('-', '').slice(0, 16);
    const app = Fastify({ logger: false });
    const events = createRealtimeEvents();
    const sessionId = (userId: string) => userId;
    const users = new Map<string, string>([['owner', ownerId], ['member', memberId], ['outsider', outsiderId]]);
    const sessionService = {
      resolveToken: async (token: string) => {
        const id = users.get(token);
        return id ? { sessionId: sessionId(id), user: { id, displayName: token } } : null;
      },
      validateId: async (id: string) => [...users.values()].includes(id)
        ? { sessionId: id, user: { id, displayName: 'Member' } } : null,
      listActiveForUser: async (id: string) => [{ id }]
    } as SessionService;
    const participants = new Map<string, Array<{ identity: string; attributes: Record<string, string> }>>();
    const removed: string[] = [];
    const admin = {
      listRooms: async () => [...participants.keys()].map((name) => ({ name })),
      listParticipants: async (room: string) => participants.get(room) ?? [],
      removeParticipant: async (room: string, identity: string) => {
        removed.push(identity);
        participants.set(room, (participants.get(room) ?? []).filter((item) => item.identity !== identity));
      }
    };
    const voice = new ServerVoiceService({ database, sessions: sessionService, events,
      apiKey, apiSecret, apiUrl: 'http://unused.invalid', publicUrl: 'wss://voice.example.invalid', admin });
    try {
      for (const [index, id] of [ownerId, memberId, outsiderId].entries()) {
        await pool.query(`insert into users(id,email,email_normalized,username,username_normalized,display_name,password_hash)
          values($1,$2,$2,$3,$3,$4,'fixture')`, [id, `${index}-${suffix}@example.invalid`, `voice_${index}_${suffix}`, `Voice ${index}`]);
      }
      await pool.query('insert into servers(id,name,owner_user_id) values($1,$3,$2),($4,$3,$2)', [serverId, ownerId, 'Voice test', otherServerId]);
      await pool.query('insert into server_members(server_id,user_id) values($1,$2),($1,$3),($4,$2)', [serverId, ownerId, memberId, otherServerId]);
      await app.register(cookie);
      app.decorateRequest('auth', null);
      await app.register(serverRoutes, { prefix: '/api/v1/servers', database, cookieName: 'session', sessionService, realtimeEvents: events, serverVoice: voice });
      await app.register(serverVoiceRoutes, { prefix: '/api/v1/server-voice', cookieName: 'session', sessionService, service: voice });
      const base = `/api/v1/servers/${serverId}`;
      const send = async (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, token = 'owner', payload?: object) =>
        app.inject({ method, url, headers: { cookie: `session=${token}`, ...(payload ? { 'content-type': 'application/json' } : {}) },
          ...(payload ? { payload: JSON.stringify(payload) } : {}) });
      const category = (await send('POST', `${base}/categories`, 'owner', { name: 'General' })).json().category;
      const foreign = (await send('POST', `/api/v1/servers/${otherServerId}/categories`, 'owner', { name: 'Foreign' })).json().category;
      const text = (await send('POST', `${base}/channels`, 'owner', { name: 'general', categoryId: category.id })).json().channel;
      assert.equal((await send('POST', `${base}/voice-channels`, 'member', { name: 'Denied' })).statusCode, 403);
      assert.equal((await send('POST', `${base}/voice-channels`, 'outsider', { name: 'Hidden' })).statusCode, 404);
      assert.equal((await send('POST', `${base}/voice-channels`, 'owner', { name: 'Foreign', categoryId: foreign.id })).statusCode, 404);
      const created = await send('POST', `${base}/voice-channels`, 'owner', { name: 'Lounge', categoryId: category.id });
      assert.equal(created.statusCode, 201, created.body);
      const channel = created.json().channel;
      assert.equal(channel.position, 1);
      assert.equal((await send('PATCH', `${base}/voice-channels/${channel.id}`, 'owner', { name: 'Gaming' })).json().channel.name, 'Gaming');
      assert.equal((await send('POST', `${base}/layout/voice/${channel.id}/move`, 'owner', { targetCategoryId: category.id, targetIndex: 0 })).statusCode, 200);
      const order = (await pool.query(`select kind, id, position from (
        select 'text' kind,id,position from server_text_channels where server_id=$1
        union all select 'voice' kind,id,position from server_voice_channels where server_id=$1
      ) layout order by position`, [serverId])).rows;
      assert.deepEqual(order.map((row) => [row.kind, row.position]), [['voice', 0], ['text', 1]]);
      assert.equal(order[1].id, text.id);
      await pool.query('update server_voice_channels set position=1 where id=$1', [channel.id]);
      const second = await send('POST', `${base}/voice-channels`, 'owner', { name: 'Workshop', categoryId: category.id });
      assert.equal(second.statusCode, 201, second.body);
      assert.equal(second.json().channel.position, 2);
      assert.deepEqual((await pool.query(`select position from (
        select position from server_text_channels where server_id=$1
        union all select position from server_voice_channels where server_id=$1
      ) layout order by position`, [serverId])).rows.map((row) => row.position), [0, 1, 2]);
      await pool.query('update server_voice_channels set category_id=$1 where id=$2', [foreign.id, channel.id]);
      assert.equal((await send('GET', `${base}/voice-channels`, 'member')).json().channels.some((item: { id: string }) => item.id === channel.id), false);
      assert.equal((await send('POST', `/api/v1/server-voice/channels/${channel.id}/token`, 'member')).statusCode, 404);
      await pool.query('update server_voice_channels set category_id=$1 where id=$2', [category.id, channel.id]);
      assert.equal((await send('GET', `${base}/voice-channels`, 'member')).json().channels.length, 2);
      assert.equal((await send('GET', `${base}/voice-channels`, 'outsider')).statusCode, 404);
      const tokenRoute = `/api/v1/server-voice/channels/${channel.id}/token`;
      assert.equal((await send('POST', tokenRoute, 'outsider')).statusCode, 404);
      assert.equal((await app.inject({ method: 'POST', url: tokenRoute })).statusCode, 401);
      const ticketResponse = await send('POST', tokenRoute, 'member');
      assert.equal(ticketResponse.statusCode, 200, ticketResponse.body);
      const claims = await new TokenVerifier(apiKey, apiSecret).verify(ticketResponse.json().token);
      assert.equal(claims.video?.room, serverVoiceRoomName(channel.id));
      participants.set(serverVoiceRoomName(channel.id), [{ identity: claims.sub!, attributes: {
        cubicUserId: memberId, cubicServerVoiceChannelId: channel.id
      } }]);
      const removal = await send('DELETE', `${base}/members/${memberId}`);
      assert.equal(removal.statusCode, 204, removal.body);
      assert.equal(removed.length, 1);
      assert.equal((await send('POST', tokenRoute, 'member')).statusCode, 404);
      assert.equal((await send('GET', `${base}/voice-channels`, 'member')).statusCode, 404);
      assert.equal((await pool.query('select count(*)::int n from server_members where server_id=$1 and user_id=$2', [serverId, memberId])).rows[0].n, 0);
      // A pre-lock channel lookup is never sufficient authority. Hold the
      // canonical server lock, remove membership, then release the waiter.
      await pool.query('insert into server_members(server_id,user_id) values($1,$2)', [serverId, memberId]);
      const blocker = await pool.connect();
      try {
        await blocker.query('begin');
        await blocker.query('select 1 from servers where id=$1 for update', [serverId]);
        const pending = voice.issueTicket({ channelId: channel.id, sessionId: memberId,
          userId: memberId, displayName: 'Member' });
        let admissionOutcome = 'pending';
        void pending.then(() => { admissionOutcome = 'issued'; }, (error: unknown) => {
          admissionOutcome = error instanceof Error ? `${error.name}: ${error.message}` : 'rejected';
        });
        let waitingForServerLock = false;
        for (let attempt = 0; attempt < 40; attempt += 1) {
          const waiting = await pool.query<{ n: number }>(
            `select count(*)::int n from pg_stat_activity
              where datname = current_database() and wait_event_type = 'Lock' and pid <> pg_backend_pid()`
          );
          if (waiting.rows[0]?.n) { waitingForServerLock = true; break; }
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        assert.equal(waitingForServerLock, true, `voice admission must wait for canonical server lock (${admissionOutcome})`);
        await blocker.query('delete from server_members where server_id=$1 and user_id=$2', [serverId, memberId]);
        await blocker.query('commit');
        await assert.rejects(pending, ServerVoiceDeniedError);
      } finally {
        await blocker.query('rollback').catch(() => {});
        blocker.release();
      }
      assert.equal((await pool.query('select count(*)::int n from server_members where server_id=$1 and user_id=$2', [serverId, memberId])).rows[0].n, 0);
    } finally {
      await app.close();
      await voice.stop();
      await pool.query('delete from server_text_channels where server_id=$1 or server_id=$2', [serverId, otherServerId]);
      await pool.query(`delete from conversations where kind='server_text' and created_by=$1`, [ownerId]);
      await pool.query('delete from servers where id=$1 or id=$2', [serverId, otherServerId]);
      await pool.query('delete from users where id=any($1::uuid[])', [[ownerId, memberId, outsiderId]]);
      await pool.end();
    }
  });
