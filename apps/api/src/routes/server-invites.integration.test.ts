import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import test from 'node:test';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { Database } from '@cubic/database';
import type { SessionService } from '../security/session.js';
import { createRealtimeEvents } from '../realtime/events.js';
import { serverRoutes } from './servers.js';
import { conversationRoutes } from './conversations.js';
import { attachmentRoutes } from './attachments.js';
import { acceptServerInvite } from '../servers/invites.js';

const connectionString = process.env.CUBIC_SERVER_TEST_DATABASE_URL ?? process.env.CUBIC_GROUP_TEST_DATABASE_URL;

test('targeted server invites serialize transitions, add membership and revoke it on leave',
  { skip: !connectionString, timeout: 30_000 }, async () => {
    const pool = new Pool({ connectionString, max: 8 });
    const owner = randomUUID(), friend = randomUUID(), outsider = randomUUID(), secondFriend = randomUUID();
    const serverId = randomUUID(), otherServerId = randomUUID(), conversationId = randomUUID(), secondChannelId = randomUUID();
    const directId = randomUUID(), groupId = randomUUID();
    const attachmentId = randomUUID(), storageKey = randomUUID();
    const ids = [owner, friend, outsider, secondFriend];
    const suffix = owner.slice(0, 8);
    const app = Fastify({ logger: false });
    const events = createRealtimeEvents();
    const removed: string[] = [];
    events.onConversationRemoved((event) => { if (event.removedUserIds.includes(friend)) removed.push(event.conversationId); });
    const actor = (name: string) => ({ cookie: `session=${name}` });
    const url = `/api/v1/servers/${serverId}`;
    try {
      for (const [index, id] of ids.entries()) {
        await pool.query(`insert into users (id,email,email_normalized,username,username_normalized,display_name,password_hash)
          values ($1,$2,$2,$3,$3,$4,'test-only')`, [id, `${index}-${suffix}@integration.invalid`, `invite_${index}_${suffix}`, `Invite ${index}`]);
      }
      for (const other of [friend, secondFriend]) {
        const [low, high] = owner < other ? [owner, other] : [other, owner];
        await pool.query('insert into friendships (user_low_id,user_high_id) values ($1,$2)', [low, high]);
      }
      await pool.query('insert into servers (id,name,owner_user_id) values ($1,$2,$3)', [serverId, 'Invited server', owner]);
      await pool.query('insert into server_members (server_id,user_id) values ($1,$2)', [serverId, owner]);
      await pool.query("insert into conversations (id,kind,created_by) values ($1,'server_text',$2)", [conversationId, owner]);
      await pool.query('insert into server_text_channels (server_id,conversation_id,name) values ($1,$2,$3)', [serverId, conversationId, 'general']);
      await pool.query("insert into conversations (id,kind,created_by) values ($1,'server_text',$2)", [secondChannelId, owner]);
      await pool.query('insert into server_text_channels (server_id,conversation_id,name) values ($1,$2,$3)', [serverId, secondChannelId, 'other']);
      await pool.query("insert into conversations (id,kind,created_by) values ($1,'direct',$3),($2,'group',$3)", [directId, groupId, owner]);
      await pool.query('insert into conversation_members (conversation_id,user_id) values ($1,$3),($1,$4),($2,$3),($2,$4)', [directId, groupId, owner, friend]);
      await app.register(cookie);
      app.decorateRequest('auth', null);
      const database = { pool, db: drizzle(pool) } as Database;
      const sessionService = {
          resolveToken: async (token: string) => {
            const id = token === 'owner' ? owner : token === 'friend' ? friend : token === 'outsider' ? outsider : token === 'second' ? secondFriend : null;
            return id ? { user: { id } } : null;
          }
        } as SessionService;
      await app.register(serverRoutes, { prefix: '/api/v1/servers', database, cookieName: 'session', realtimeEvents: events, sessionService });
      await app.register(conversationRoutes, { prefix: '/api/v1/conversations', database, cookieName: 'session', realtimeEvents: events, sessionService });
      await app.register(attachmentRoutes, {
        prefix: '/api/v1', database, cookieName: 'session', sessionService,
        attachmentStore: { detectForDelivery: async () => 'text/plain', open: () => Readable.from(['content']) } as never,
        attachmentMaxBytes: 1024, attachmentPendingMaxCount: 20, attachmentPendingMaxBytes: 10_000,
        attachmentMinFreeBytes: 1024, insertPendingAttachment: (() => { throw new Error('Not used.'); }) as never
      });

      const inviteUrl = `${url}/invites`;
      assert.equal((await app.inject({ method: 'POST', url: inviteUrl, payload: { userId: friend } })).statusCode, 401);
      assert.equal((await app.inject({ method: 'POST', url: inviteUrl, headers: actor('outsider'), payload: { userId: friend } })).statusCode, 404);
      assert.equal((await app.inject({ method: 'POST', url: inviteUrl, headers: actor('owner'), payload: { userId: outsider } })).statusCode, 403);
      assert.equal((await app.inject({ method: 'POST', url: inviteUrl, headers: actor('owner'), payload: { userId: owner } })).statusCode, 403);
      const [first, duplicate] = await Promise.all([
        app.inject({ method: 'POST', url: inviteUrl, headers: actor('owner'), payload: { userId: friend, inviterUserId: outsider } }),
        app.inject({ method: 'POST', url: inviteUrl, headers: actor('owner'), payload: { userId: friend } })
      ]);
      assert.deepEqual([first.statusCode, duplicate.statusCode].sort(), [201, 409]);
      const invite = (first.statusCode === 201 ? first : duplicate).json().invite;
      assert.equal(invite.inviter.id, owner);
      assert.deepEqual(Object.keys(invite).sort(), ['createdAt', 'id', 'invitee', 'inviter', 'serverId', 'serverName']);
      assert.equal((await app.inject({ method: 'GET', url: '/api/v1/servers/invites', headers: actor('friend') })).json().invites.length, 1);
      assert.equal((await app.inject({ method: 'GET', url: inviteUrl, headers: actor('owner') })).json().invites.length, 1);
      assert.equal((await app.inject({ method: 'GET', url: inviteUrl, headers: actor('outsider') })).statusCode, 404);
      assert.equal((await app.inject({ method: 'POST', url: `/api/v1/servers/invites/${invite.id}/accept`, headers: actor('outsider') })).statusCode, 404);
      await pool.query('delete from friendships where (user_low_id=$1 and user_high_id=$2) or (user_low_id=$2 and user_high_id=$1)', [owner, friend]);

      const [accepted, competing] = await Promise.all([
        app.inject({ method: 'POST', url: `/api/v1/servers/invites/${invite.id}/accept`, headers: actor('friend') }),
        app.inject({ method: 'POST', url: `/api/v1/servers/invites/${invite.id}/accept`, headers: actor('friend') })
      ]);
      assert.deepEqual([accepted.statusCode, competing.statusCode].sort(), [200, 404]);
      assert.equal((await pool.query('select status from server_invites where id = $1', [invite.id])).rows[0].status, 'accepted');
      assert.equal((await pool.query('select count(*)::int as n from server_members where server_id=$1 and user_id=$2', [serverId, friend])).rows[0].n, 1);
      assert.equal((await pool.query('select count(*)::int as n from conversation_members where conversation_id=$1', [conversationId])).rows[0].n, 0);
      assert.equal((await app.inject({ method: 'POST', url: `/api/v1/servers/invites/${invite.id}/accept`, headers: actor('friend') })).statusCode, 404);
      assert.equal((await app.inject({ method: 'POST', url: inviteUrl, headers: actor('owner'), payload: { userId: friend } })).statusCode, 409);
      assert.equal((await app.inject({ method: 'GET', url: `${url}/channels`, headers: actor('friend') })).statusCode, 200);
      const messagesUrl = `/api/v1/conversations/${conversationId}/messages`;
      assert.equal((await app.inject({ method: 'GET', url: messagesUrl, headers: actor('friend') })).statusCode, 200);
      const sent = await app.inject({ method: 'POST', url: messagesUrl, headers: actor('friend'), payload: { clientMessageId: randomUUID(), body: 'joined' } });
      assert.equal(sent.statusCode, 201);
      const messageId = sent.json().message.id as string;
      assert.equal((await app.inject({ method: 'PUT', url: `${messagesUrl}/${messageId}/reactions`, headers: actor('friend'), payload: { reaction: '👍' } })).statusCode, 200);
      await pool.query(`insert into attachments (id,conversation_id,uploader_id,message_id,storage_key,original_name,content_type,size_bytes)
        values ($1,$2,$3,$4,$5,'proof.txt','text/plain',7)`, [attachmentId, conversationId, friend, messageId, storageKey]);
      const contentUrl = `/api/v1/attachments/${attachmentId}/content`;
      assert.equal((await app.inject({ method: 'GET', url: contentUrl, headers: actor('friend') })).statusCode, 200);
      assert.equal((await app.inject({ method: 'GET', url: contentUrl, headers: actor('outsider') })).statusCode, 404);
      assert.equal((await app.inject({ method: 'GET', url: `${url}/members`, headers: actor('friend') })).json().members.length, 2);
      assert.equal((await app.inject({ method: 'POST', url: `${url}/leave`, headers: actor('owner') })).statusCode, 403);
      assert.equal((await app.inject({ method: 'POST', url: `${url}/leave`, headers: actor('outsider') })).statusCode, 404);
      assert.equal((await app.inject({ method: 'POST', url: `${url}/leave`, headers: actor('friend') })).statusCode, 204);
      assert.deepEqual(new Set(removed), new Set([conversationId, secondChannelId]));
      assert.equal(removed.length, 2);
      assert.equal((await app.inject({ method: 'GET', url: `${url}/channels`, headers: actor('friend') })).statusCode, 404);
      assert.equal((await app.inject({ method: 'GET', url: messagesUrl, headers: actor('friend') })).statusCode, 404);
      assert.equal((await app.inject({ method: 'POST', url: messagesUrl, headers: actor('friend'), payload: { clientMessageId: randomUUID(), body: 'no longer' } })).statusCode, 404);
      assert.equal((await app.inject({ method: 'PUT', url: `${messagesUrl}/${messageId}/reactions`, headers: actor('friend'), payload: { reaction: '👍' } })).statusCode, 404);
      assert.equal((await app.inject({ method: 'GET', url: contentUrl, headers: actor('friend') })).statusCode, 404);
      assert.equal((await pool.query('select body from messages where id=$1', [messageId])).rows[0].body, 'joined');
      assert.equal((await app.inject({ method: 'GET', url: '/api/v1/servers', headers: actor('friend') })).json().servers.length, 0);

      const [friendLow, friendHigh] = owner < friend ? [owner, friend] : [friend, owner];
      await pool.query('insert into friendships (user_low_id,user_high_id) values ($1,$2)', [friendLow, friendHigh]);
      const reinvite = await app.inject({ method: 'POST', url: inviteUrl, headers: actor('owner'), payload: { userId: friend } });
      assert.equal(reinvite.statusCode, 201);
      assert.equal((await app.inject({ method: 'POST', url: `/api/v1/servers/invites/${reinvite.json().invite.id}/accept`, headers: actor('friend') })).statusCode, 200);
      const removeUrl = `${url}/members/${friend}`;
      assert.equal((await app.inject({ method: 'DELETE', url: removeUrl })).statusCode, 401);
      assert.equal((await app.inject({ method: 'DELETE', url: removeUrl, headers: actor('friend') })).statusCode, 403);
      assert.equal((await app.inject({ method: 'DELETE', url: removeUrl, headers: actor('outsider') })).statusCode, 404);
      assert.equal((await app.inject({ method: 'DELETE', url: `${url}/members/${owner}`, headers: actor('owner') })).statusCode, 403);
      await pool.query('insert into servers (id,name,owner_user_id) values ($1,$2,$3)', [otherServerId, 'Other server', outsider]);
      await pool.query('insert into server_members (server_id,user_id) values ($1,$2),($1,$3)', [otherServerId, outsider, secondFriend]);
      assert.equal((await app.inject({ method: 'DELETE', url: `${url}/members/${secondFriend}`, headers: actor('owner') })).statusCode, 404);
      assert.equal((await pool.query('select 1 from server_members where server_id=$1 and user_id=$2', [otherServerId, secondFriend])).rowCount, 1);
      assert.equal((await app.inject({ method: 'DELETE', url: removeUrl, headers: actor('owner') })).statusCode, 204);
      assert.equal((await app.inject({ method: 'DELETE', url: removeUrl, headers: actor('owner') })).statusCode, 404);
      assert.deepEqual(new Set(removed), new Set([conversationId, secondChannelId]));
      assert.equal(removed.length, 4);
      assert.equal((await app.inject({ method: 'GET', url: `${url}/categories`, headers: actor('friend') })).statusCode, 404);
      assert.equal((await app.inject({ method: 'GET', url: `${url}/channels`, headers: actor('friend') })).statusCode, 404);
      assert.equal((await app.inject({ method: 'GET', url: messagesUrl, headers: actor('friend') })).statusCode, 404);
      assert.equal((await app.inject({ method: 'POST', url: messagesUrl, headers: actor('friend'), payload: { clientMessageId: randomUUID(), body: 'removed' } })).statusCode, 404);
      assert.equal((await app.inject({ method: 'GET', url: contentUrl, headers: actor('friend') })).statusCode, 404);
      assert.equal((await pool.query('select body from messages where id=$1', [messageId])).rows[0].body, 'joined');
      assert.equal((await pool.query('select status from server_invites where id=$1', [invite.id])).rows[0].status, 'accepted');
      assert.equal((await pool.query('select status from server_invites where id=$1', [reinvite.json().invite.id])).rows[0].status, 'accepted');
      assert.equal((await pool.query('select 1 from friendships where user_low_id=$1 and user_high_id=$2', [friendLow, friendHigh])).rowCount, 1);
      assert.equal((await pool.query('select count(*)::int as n from conversation_members where user_id=$1 and conversation_id=any($2::uuid[])', [friend, [directId, groupId]])).rows[0].n, 2);

      const duplicateRaceInvite = await app.inject({ method: 'POST', url: inviteUrl, headers: actor('owner'), payload: { userId: friend } });
      assert.equal(duplicateRaceInvite.statusCode, 201);
      assert.equal((await app.inject({ method: 'POST', url: `/api/v1/servers/invites/${duplicateRaceInvite.json().invite.id}/accept`, headers: actor('friend') })).statusCode, 200);
      const duplicateRemovals = await Promise.all([
        app.inject({ method: 'DELETE', url: removeUrl, headers: actor('owner') }),
        app.inject({ method: 'DELETE', url: removeUrl, headers: actor('owner') })
      ]);
      assert.deepEqual(duplicateRemovals.map((result) => result.statusCode).sort(), [204, 404]);
      assert.equal((await pool.query('select 1 from server_members where server_id=$1 and user_id=$2', [serverId, friend])).rowCount, 0);

      const leaveRaceInvite = await app.inject({ method: 'POST', url: inviteUrl, headers: actor('owner'), payload: { userId: friend } });
      assert.equal(leaveRaceInvite.statusCode, 201);
      assert.equal((await app.inject({ method: 'POST', url: `/api/v1/servers/invites/${leaveRaceInvite.json().invite.id}/accept`, headers: actor('friend') })).statusCode, 200);
      const leaveRemoveRace = await Promise.all([
        app.inject({ method: 'POST', url: `${url}/leave`, headers: actor('friend') }),
        app.inject({ method: 'DELETE', url: removeUrl, headers: actor('owner') })
      ]);
      assert.deepEqual(leaveRemoveRace.map((result) => result.statusCode).sort(), [204, 404]);
      assert.equal((await pool.query('select 1 from server_members where server_id=$1 and user_id=$2', [serverId, friend])).rowCount, 0);

      const second = await app.inject({ method: 'POST', url: inviteUrl, headers: actor('owner'), payload: { userId: secondFriend } });
      assert.equal(second.statusCode, 201);
      const secondId = second.json().invite.id;
      assert.equal((await app.inject({ method: 'DELETE', url: `/api/v1/servers/invites/${secondId}`, headers: actor('outsider') })).statusCode, 404);
      assert.equal((await app.inject({ method: 'DELETE', url: `/api/v1/servers/invites/${secondId}`, headers: actor('owner') })).statusCode, 204);
      assert.equal((await app.inject({ method: 'POST', url: `/api/v1/servers/invites/${secondId}/accept`, headers: actor('second') })).statusCode, 404);
      assert.equal((await pool.query('select status from server_invites where id=$1', [secondId])).rows[0].status, 'cancelled');
      const raceInvite = await app.inject({ method: 'POST', url: inviteUrl, headers: actor('owner'), payload: { userId: secondFriend } });
      assert.equal(raceInvite.statusCode, 201);
      const raceId = raceInvite.json().invite.id;
      const [raceAccept, raceCancel] = await Promise.all([
        app.inject({ method: 'POST', url: `/api/v1/servers/invites/${raceId}/accept`, headers: actor('second') }),
        app.inject({ method: 'DELETE', url: `/api/v1/servers/invites/${raceId}`, headers: actor('owner') })
      ]);
      assert.deepEqual([raceAccept.statusCode, raceCancel.statusCode].sort(), raceAccept.statusCode === 200 ? [200, 404] : [204, 404]);
      const raceStatus = (await pool.query('select status from server_invites where id=$1', [raceId])).rows[0].status;
      const secondMemberCount = (await pool.query('select count(*)::int as n from server_members where server_id=$1 and user_id=$2', [serverId, secondFriend])).rows[0].n;
      assert.equal(secondMemberCount, raceStatus === 'accepted' ? 1 : 0);
    } finally {
      await app.close();
      await pool.query('delete from server_invites where server_id = $1', [serverId]);
      await pool.query('delete from message_reactions where message_id in (select id from messages where conversation_id = $1)', [conversationId]);
      await pool.query('delete from attachments where conversation_id = $1', [conversationId]);
      await pool.query('delete from messages where conversation_id = $1', [conversationId]);
      await pool.query('delete from server_text_channels where server_id = $1', [serverId]);
      await pool.query('delete from conversations where id = any($1::uuid[])', [[conversationId, secondChannelId, directId, groupId]]);
      await pool.query('delete from servers where id = $1', [serverId]);
      await pool.query('delete from servers where id = $1', [otherServerId]);
      await pool.query('delete from users where id = any($1::uuid[])', [ids]);
      await pool.end();
    }
  });

test('PostgreSQL enforces targeted invite constraints, pending uniqueness and FK cascades',
  { skip: !connectionString, timeout: 20_000 }, async () => {
    const pool = new Pool({ connectionString, max: 1 });
    const client = await pool.connect();
    const owner = randomUUID(), invitee = randomUUID(), third = randomUUID(), serverId = randomUUID(), extraServerId = randomUUID();
    async function expectCode(sql: string, values: unknown[], code: string) {
      await client.query('savepoint expected_failure');
      try { await assert.rejects(client.query(sql, values), (error: any) => error.code === code); }
      finally {
        await client.query('rollback to savepoint expected_failure');
        await client.query('release savepoint expected_failure');
      }
    }
    const insert = 'insert into server_invites (server_id,inviter_user_id,invitee_user_id,status) values ($1,$2,$3,$4) returning id';
    try {
      await client.query('begin');
      for (const [i, id] of [owner, invitee, third].entries()) {
        await client.query(`insert into users (id,email,email_normalized,username,username_normalized,display_name,password_hash)
          values ($1,$2,$2,$3,$3,$4,'test-only')`, [id, `${id}@integration.invalid`, `invite_fk_${i}_${id.slice(0, 8)}`, `Fixture ${i}`]);
      }
      await client.query('insert into servers (id,name,owner_user_id) values ($1,$2,$3)', [serverId, 'Constraints', owner]);
      await expectCode(insert, [randomUUID(), owner, invitee, 'pending'], '23503');
      await expectCode(insert, [serverId, randomUUID(), invitee, 'pending'], '23503');
      await expectCode(insert, [serverId, owner, randomUUID(), 'pending'], '23503');
      await expectCode(insert, [serverId, owner, owner, 'pending'], '23514');
      await expectCode(insert, [serverId, owner, invitee, 'declined'], '23514');
      const acceptedId = (await client.query(insert, [serverId, owner, invitee, 'pending'])).rows[0].id;
      await expectCode(insert, [serverId, owner, invitee, 'pending'], '23505');
      await client.query("update server_invites set status='accepted' where id=$1", [acceptedId]);
      const cancelledId = (await client.query(insert, [serverId, owner, invitee, 'pending'])).rows[0].id;
      await client.query("update server_invites set status='cancelled' where id=$1", [cancelledId]);
      await client.query(insert, [serverId, owner, invitee, 'pending']);
      await client.query('insert into servers (id,name,owner_user_id) values ($1,$2,$3)', [extraServerId, 'Cascade', owner]);
      await client.query(insert, [extraServerId, owner, third, 'pending']);
      await client.query('delete from servers where id=$1', [extraServerId]);
      assert.equal((await client.query('select 1 from server_invites where server_id=$1', [extraServerId])).rowCount, 0);
      await client.query(insert, [serverId, third, owner, 'pending']);
      await client.query('delete from users where id=$1', [third]);
      assert.equal((await client.query('select 1 from server_invites where inviter_user_id=$1', [third])).rowCount, 0);
      await client.query('delete from users where id=$1', [invitee]);
      assert.equal((await client.query('select 1 from server_invites where invitee_user_id=$1', [invitee])).rowCount, 0);
      await client.query('delete from servers where id=$1', [serverId]);
      assert.equal((await client.query('select 1 from server_invites where server_id=$1', [serverId])).rowCount, 0);
      await client.query('rollback');
    } finally {
      await client.query('rollback').catch(() => {});
      client.release();
      await pool.end();
    }
  });

test('acceptance rolls back membership and invite state on either database write failure',
  { skip: !connectionString, timeout: 20_000 }, async () => {
    const pool = new Pool({ connectionString, max: 3 });
    const owner = randomUUID(), invitee = randomUUID(), serverId = randomUUID();
    let inviteId: string | null = null;
    try {
      for (const [i, id] of [owner, invitee].entries()) {
        await pool.query(`insert into users (id,email,email_normalized,username,username_normalized,display_name,password_hash)
          values ($1,$2,$2,$3,$3,$4,'test-only')`, [id, `${id}@integration.invalid`, `invite_atomic_${i}_${id.slice(0, 8)}`, `Fixture ${i}`]);
      }
      await pool.query('insert into servers (id,name,owner_user_id) values ($1,$2,$3)', [serverId, 'Atomic', owner]);
      await pool.query('insert into server_members (server_id,user_id) values ($1,$2)', [serverId, owner]);
      inviteId = (await pool.query(
        'insert into server_invites (server_id,inviter_user_id,invitee_user_id) values ($1,$2,$3) returning id',
        [serverId, owner, invitee]
      )).rows[0].id;
      if (!inviteId) throw new Error('Invite insert returned no row.');
      const currentInviteId = inviteId;
      for (const statement of ['insert into server_members', 'update server_invites set status']) {
        const injected = {
          pool: {
            query: pool.query.bind(pool),
            connect: async () => {
              const client = await pool.connect();
              return {
                query: (sql: string, values?: unknown[]) => {
                  if (sql.toLowerCase().startsWith(statement)) throw new Error('injected database failure');
                  return client.query(sql, values);
                },
                release: () => client.release()
              };
            }
          }
        } as unknown as Database;
        await assert.rejects(acceptServerInvite(injected, currentInviteId, invitee), /injected database failure/);
        assert.equal((await pool.query('select status from server_invites where id=$1', [currentInviteId])).rows[0].status, 'pending');
        assert.equal((await pool.query('select 1 from server_members where server_id=$1 and user_id=$2', [serverId, invitee])).rowCount, 0);
      }
      assert.deepEqual(await acceptServerInvite({ pool } as Database, currentInviteId, invitee), { value: serverId });
    } finally {
      if (inviteId) await pool.query('delete from server_invites where id=$1', [inviteId]);
      await pool.query('delete from servers where id=$1', [serverId]);
      await pool.query('delete from users where id=any($1::uuid[])', [[owner, invitee]]);
      await pool.end();
    }
  });
