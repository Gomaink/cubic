import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { Database } from '@cubic/database';
import type { SessionService } from '../security/session.js';
import { createRealtimeEvents } from '../realtime/events.js';
import { serverRoutes } from './servers.js';
import { serverInviteLinkRoutes } from './server-invite-links.js';
import { conversationRoutes } from './conversations.js';
import { joinServerViaInviteLink, revokeServerInviteLink } from '../servers/invite-links.js';

const connectionString = process.env.CUBIC_SERVER_TEST_DATABASE_URL ?? process.env.CUBIC_GROUP_TEST_DATABASE_URL;

test('shareable links are digest-only, owner-managed and grant normal removable membership',
  { skip: !connectionString, timeout: 30_000 }, async () => {
    const pool = new Pool({ connectionString, max: 8 });
    const owner = randomUUID(), joiner = randomUUID(), outsider = randomUUID();
    const serverId = randomUUID(), otherServerId = randomUUID(), conversationId = randomUUID();
    const suffix = owner.slice(0, 8);
    const app = Fastify({ logger: false });
    const actor = (name: string) => ({ cookie: `session=${name}` });
    const base = `/api/v1/servers/${serverId}`;
    const previewUrl = '/api/v1/server-invite-links/preview';
    const joinUrl = '/api/v1/server-invite-links/join';
    try {
      for (const [index, id] of [owner, joiner, outsider].entries()) {
        await pool.query(`insert into users (id,email,email_normalized,username,username_normalized,display_name,password_hash)
          values ($1,$2,$2,$3,$3,$4,'proof')`, [id, `link-${index}-${suffix}@proof.invalid`, `link_${index}_${suffix}`, `Link ${index}`]);
      }
      await pool.query('insert into servers (id,name,owner_user_id) values ($1,$2,$3),($4,$5,$6)',
        [serverId, 'Share proof', owner, otherServerId, 'Other proof', outsider]);
      await pool.query('insert into server_members (server_id,user_id) values ($1,$2),($3,$4)', [serverId, owner, otherServerId, outsider]);
      await pool.query("insert into conversations (id,kind,created_by) values ($1,'server_text',$2)", [conversationId, owner]);
      await pool.query('insert into server_text_channels (server_id,conversation_id,name) values ($1,$2,$3)', [serverId, conversationId, 'general']);
      await pool.query("insert into server_invites (server_id,inviter_user_id,invitee_user_id,status) values ($1,$2,$3,'cancelled')", [serverId, owner, joiner]);

      await app.register(cookie);
      app.decorateRequest('auth', null);
      const database = { pool, db: drizzle(pool) } as Database;
      const sessionService = { resolveToken: async (token: string) => {
        const id = token === 'owner' ? owner : token === 'joiner' ? joiner : token === 'outsider' ? outsider : null;
        return id ? { user: { id } } : null;
      } } as SessionService;
      const events = createRealtimeEvents();
      await app.register(serverRoutes, { prefix: '/api/v1/servers', database, cookieName: 'session', sessionService, realtimeEvents: events });
      await app.register(serverInviteLinkRoutes, { prefix: '/api/v1/server-invite-links', database, cookieName: 'session', sessionService });
      await app.register(conversationRoutes, { prefix: '/api/v1/conversations', database, cookieName: 'session', sessionService, realtimeEvents: events });

      const createUrl = `${base}/invite-links`;
      assert.equal((await app.inject({ method: 'POST', url: createUrl })).statusCode, 401);
      assert.equal((await app.inject({ method: 'POST', url: createUrl, headers: actor('joiner') })).statusCode, 404);
      assert.equal((await app.inject({ method: 'POST', url: createUrl, headers: actor('outsider') })).statusCode, 404);
      const created = await app.inject({ method: 'POST', url: createUrl, headers: actor('owner'), payload: { creatorUserId: outsider } });
      assert.equal(created.statusCode, 201);
      assert.equal(created.headers['cache-control'], 'no-store');
      const { inviteLink, token } = created.json();
      assert.equal(/^[A-Za-z0-9_-]{43}$/.test(token), true);
      assert.deepEqual(Object.keys(inviteLink).sort(), ['createdAt', 'expiresAt', 'id', 'revokedAt']);
      assert.equal(Date.parse(inviteLink.expiresAt) - Date.parse(inviteLink.createdAt), 7 * 24 * 60 * 60 * 1000);
      const stored = (await pool.query('select token_digest,creator_user_id from server_invite_links where id=$1', [inviteLink.id])).rows[0];
      assert.equal(stored.token_digest, createHash('sha256').update(token).digest('hex'));
      assert.equal(stored.creator_user_id, owner);
      assert.equal(stored.token_digest.includes(token), false);
      assert.equal((await pool.query('select count(*)::int n from server_invites where server_id=$1', [serverId])).rows[0].n, 1);
      const second = await app.inject({ method: 'POST', url: createUrl, headers: actor('owner') });
      assert.equal(second.statusCode, 201);
      assert.equal(second.json().token === token, false);
      const listed = await app.inject({ method: 'GET', url: createUrl, headers: actor('owner') });
      assert.equal(listed.json().inviteLinks.length, 2);
      assert.equal(JSON.stringify(listed.json()).includes(token), false);
      assert.equal(JSON.stringify(listed.json()).includes(stored.token_digest), false);
      assert.equal((await app.inject({ method: 'GET', url: createUrl, headers: actor('joiner') })).statusCode, 404);

      const active = await app.inject({ method: 'POST', url: previewUrl, payload: { token } });
      assert.deepEqual(active.json(), { valid: true, server: { id: serverId, name: 'Share proof' } });
      assert.equal((await app.inject({ method: 'POST', url: previewUrl, payload: { token: 'x'.repeat(5000) } })).statusCode, 413);
      for (const invalid of ['bad', 'z'.repeat(43)]) {
        const response = await app.inject({ method: 'POST', url: previewUrl, payload: { token: invalid } });
        assert.equal(response.statusCode, 404);
        assert.deepEqual(response.json(), { error: 'Invite unavailable.' });
      }
      assert.equal((await app.inject({ method: 'POST', url: joinUrl, payload: { token } })).statusCode, 401);
      const [joined, repeat] = await Promise.all([
        app.inject({ method: 'POST', url: joinUrl, headers: actor('joiner'), payload: { token } }),
        app.inject({ method: 'POST', url: joinUrl, headers: actor('joiner'), payload: { token } })
      ]);
      assert.deepEqual([joined.json().joined, repeat.json().joined].sort(), [false, true]);
      assert.equal((await pool.query('select count(*)::int n from server_members where server_id=$1 and user_id=$2', [serverId, joiner])).rows[0].n, 1);
      assert.equal((await pool.query('select count(*)::int n from conversation_members where conversation_id=$1', [conversationId])).rows[0].n, 0);
      assert.equal((await app.inject({ method: 'GET', url: `${base}/channels`, headers: actor('joiner') })).statusCode, 200);
      assert.equal((await app.inject({ method: 'POST', url: createUrl, headers: actor('joiner') })).statusCode, 403);
      assert.equal((await app.inject({ method: 'GET', url: `/api/v1/conversations/${conversationId}/messages`, headers: actor('joiner') })).statusCode, 200);
      assert.equal((await app.inject({ method: 'POST', url: previewUrl, headers: actor('joiner'), payload: { token } })).json().alreadyMember, true);
      assert.equal((await app.inject({ method: 'DELETE', url: `${base}/members/${joiner}`, headers: actor('owner') })).statusCode, 204);
      assert.equal((await app.inject({ method: 'GET', url: `${base}/channels`, headers: actor('joiner') })).statusCode, 404);
      assert.equal((await app.inject({ method: 'POST', url: joinUrl, headers: actor('joiner'), payload: { token } })).json().joined, true);
      assert.equal((await pool.query('select status from server_invites where server_id=$1', [serverId])).rows[0].status, 'cancelled');

      const cross = await app.inject({ method: 'POST', url: `/api/v1/servers/${otherServerId}/invite-links/${inviteLink.id}/revoke`, headers: actor('outsider') });
      assert.equal(cross.statusCode, 404);
      assert.equal((await app.inject({ method: 'POST', url: `${base}/invite-links/${inviteLink.id}/revoke`, headers: actor('joiner') })).statusCode, 403);
      const revoked = await app.inject({ method: 'POST', url: `${base}/invite-links/${inviteLink.id}/revoke`, headers: actor('owner') });
      assert.equal(revoked.statusCode, 200);
      const revokedAgain = await app.inject({ method: 'POST', url: `${base}/invite-links/${inviteLink.id}/revoke`, headers: actor('owner') });
      assert.equal(revokedAgain.json().inviteLink.revokedAt, revoked.json().inviteLink.revokedAt);
      const unavailable = await app.inject({ method: 'POST', url: previewUrl, payload: { token } });
      assert.equal(unavailable.statusCode, 404);
      assert.deepEqual(unavailable.json(), { error: 'Invite unavailable.' });
      assert.equal((await app.inject({ method: 'POST', url: joinUrl, headers: actor('outsider'), payload: { token } })).statusCode, 404);
      await pool.query("update server_invite_links set created_at=now()-interval '2 days', expires_at=now()-interval '1 day' where id=$1", [second.json().inviteLink.id]);
      const expired = await app.inject({ method: 'POST', url: previewUrl, payload: { token: second.json().token } });
      assert.equal(expired.statusCode, 404);
      assert.deepEqual(expired.json(), unavailable.json());
      assert.equal((await app.inject({ method: 'POST', url: joinUrl, headers: actor('outsider'), payload: { token: second.json().token } })).statusCode, 404);
    } finally {
      await app.close();
      await pool.query('delete from server_invite_links where server_id=$1', [serverId]);
      await pool.query('delete from server_invites where server_id=$1', [serverId]);
      await pool.query('delete from server_text_channels where server_id=$1', [serverId]);
      await pool.query('delete from conversations where id=$1', [conversationId]);
      await pool.query('delete from servers where id=any($1::uuid[])', [[serverId, otherServerId]]);
      await pool.query('delete from users where id=any($1::uuid[])', [[owner, joiner, outsider]]);
      await pool.end();
    }
  });

test('join and revoke serialize on the server lock and reject stale pre-lock validity',
  { skip: !connectionString, timeout: 30_000 }, async () => {
    const pool = new Pool({ connectionString, max: 8 });
    const owner = randomUUID(), joiner = randomUUID(), server = randomUUID();
    const suffix = owner.slice(0, 8);
    const token = randomUUID();
    const digest = createHash('sha256').update(token).digest('hex');
    const database = { pool, db: drizzle(pool) } as Database;
    try {
      for (const [i, id] of [owner, joiner].entries()) await pool.query(`insert into users (id,email,email_normalized,username,username_normalized,display_name,password_hash)
        values ($1,$2,$2,$3,$3,$4,'proof')`, [id, `lock-${i}-${suffix}@proof.invalid`, `lock_${i}_${suffix}`, `Lock ${i}`]);
      await pool.query('insert into servers (id,name,owner_user_id) values ($1,$2,$3)', [server, 'Lock proof', owner]);
      await pool.query('insert into server_members (server_id,user_id) values ($1,$2)', [server, owner]);
      const link = (await pool.query(`insert into server_invite_links (server_id,creator_user_id,token_digest,expires_at)
        values ($1,$2,$3,now()+interval '7 days') returning id`, [server, owner, digest])).rows[0].id;
      const blocker = await pool.connect();
      try {
        await blocker.query('begin');
        await blocker.query('select 1 from servers where id=$1 for update', [server]);
        const revoke = revokeServerInviteLink(database, server, link, owner);
        await new Promise((resolve) => setTimeout(resolve, 20));
        const join = joinServerViaInviteLink(database, token, joiner);
        await new Promise((resolve) => setTimeout(resolve, 20));
        await blocker.query('commit');
        assert.ok('value' in await revoke);
        assert.deepEqual(await join, { denied: 'unavailable' });
      } finally {
        await blocker.query('rollback').catch(() => {});
        blocker.release();
      }
      assert.equal((await pool.query('select count(*)::int n from server_members where server_id=$1 and user_id=$2', [server, joiner])).rows[0].n, 0);
    } finally {
      await pool.query('delete from servers where id=$1', [server]);
      await pool.query('delete from users where id=any($1::uuid[])', [[owner, joiner]]);
      await pool.end();
    }
  });
