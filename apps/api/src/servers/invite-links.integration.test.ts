import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { Database } from '@cubic/database';
import { InviteCredentials } from './invite-credentials.js';
import { copyServerInviteLink, createServerInviteLink, joinServerViaInviteLink, previewServerInviteLink,
  revokeServerInviteLink, setServerInvitesPaused, updateServerInviteLink } from './invite-links.js';

const connectionString = process.env.CUBIC_SERVER_TEST_DATABASE_URL ?? process.env.CUBIC_GROUP_TEST_DATABASE_URL;

test('invite link v2 counters, legacy aliases, pause, revocation and creator history survive PostgreSQL',
  { skip: !connectionString, timeout: 45_000 }, async () => {
    const pool = new Pool({ connectionString, max: 8 });
    const database = { pool, db: drizzle(pool) } as Database;
    const ids = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    const [owner, first, second, creator, late, editActor] = ids as [string, string, string, string, string, string];
    const server = randomUUID();
    const keys = new InviteCredentials('current', { current: randomBytes(32).toString('base64url') });
    try {
      for (const [index, id] of ids.entries()) await pool.query(
        `insert into users(id,email,email_normalized,username,username_normalized,display_name,password_hash)
         values($1,$2,$2,$3,$3,$4,'proof')`,
        [id, `invite-v2-${id}@proof.invalid`, `invite_v2_${id.slice(0, 8)}`, `Actor ${index}`]);
      await pool.query('insert into servers(id,name,owner_user_id) values($1,$2,$3)', [server, 'Invite V2', owner]);
      await pool.query('insert into server_members(server_id,user_id) values($1,$2)', [server, owner]);

      const created = await createServerInviteLink(database, server, owner, keys, { expiration: 'never', maxUses: 1 });
      assert.ok('value' in created);
      const { token, inviteLink } = created.value;
      assert.equal(inviteLink.expiresAt, null);
      assert.equal(inviteLink.maxUses, 1);
      assert.equal((await pool.query('select token_digest from server_invite_links where id=$1', [inviteLink.id])).rows[0].token_digest,
        createHash('sha256').update(token).digest('hex'));
      assert.deepEqual((await Promise.all([joinServerViaInviteLink(database, token, first, keys), joinServerViaInviteLink(database, token, second, keys)]))
        .map((result) => 'value' in result ? result.value.joined : result.denied).sort(), [true, 'unavailable'].sort());
      assert.equal((await pool.query('select use_count from server_invite_links where id=$1', [inviteLink.id])).rows[0].use_count, 1);
      const winner = (await pool.query('select user_id from server_members where server_id=$1 and user_id<>$2', [server, owner])).rows[0].user_id;
      assert.deepEqual(await joinServerViaInviteLink(database, token, winner, keys), { value: { server: { id: server, name: 'Invite V2' }, joined: false, alreadyMember: true } });
      assert.ok('value' in await updateServerInviteLink(database, server, inviteLink.id, owner, { maxUses: 5 }));
      assert.ok('value' in await joinServerViaInviteLink(database, token, winner === first ? second : first, keys));
      assert.equal((await pool.query('select use_count from server_invite_links where id=$1', [inviteLink.id])).rows[0].use_count, 2);

      const oldToken = randomBytes(32).toString('base64url');
      const legacy = (await pool.query(`insert into server_invite_links(server_id,creator_user_id,token_digest,expires_at)
        values($1,$2,$3,clock_timestamp()+interval '1 day') returning id`,
        [server, creator, createHash('sha256').update(oldToken).digest('hex')])).rows[0].id as string;
      const copied = await copyServerInviteLink(database, server, legacy, owner, keys);
      assert.ok('value' in copied);
      assert.equal(keys.verify(copied.value.token), legacy);
      assert.ok('value' in await previewServerInviteLink(database, oldToken, undefined, keys));
      assert.ok('value' in await previewServerInviteLink(database, copied.value.token, undefined, keys));
      await pool.query('delete from users where id=$1', [creator]);
      assert.equal((await pool.query('select creator_user_id from server_invite_links where id=$1', [legacy])).rows[0].creator_user_id, null);
      assert.ok('value' in await setServerInvitesPaused(database, server, owner, true));
      assert.deepEqual(await previewServerInviteLink(database, oldToken, undefined, keys), { denied: 'unavailable' });
      assert.deepEqual(await joinServerViaInviteLink(database, copied.value.token, first, keys), { denied: 'unavailable' });
      assert.ok('value' in await setServerInvitesPaused(database, server, owner, false));
      assert.ok('value' in await revokeServerInviteLink(database, server, legacy, owner));
      assert.deepEqual(await previewServerInviteLink(database, oldToken, undefined, keys), { denied: 'unavailable' });
      assert.deepEqual(await previewServerInviteLink(database, copied.value.token, undefined, keys), { denied: 'unavailable' });

      const fresh = await createServerInviteLink(database, server, owner, keys);
      assert.ok('value' in fresh);
      const originalConnect = pool.connect.bind(pool);
      const faultDatabase = { pool: {
        query: pool.query.bind(pool),
        connect: async () => {
          const client = await originalConnect();
          return new Proxy(client, { get(target, property) {
            if (property === 'query') return (...arguments_: unknown[]) => {
              if (typeof arguments_[0] === 'string' && arguments_[0].includes('set use_count=use_count+1'))
                throw new Error('synthetic counter fault');
              return target.query(...arguments_ as [string, unknown[]]);
            };
            const value = Reflect.get(target, property);
            return typeof value === 'function' ? value.bind(target) : value;
          } });
        }
      } } as unknown as Database;
      await assert.rejects(joinServerViaInviteLink(faultDatabase, fresh.value.token, late, keys), /synthetic counter fault/);
      assert.equal((await pool.query('select 1 from server_members where server_id=$1 and user_id=$2', [server, late])).rowCount, 0);
      assert.equal((await pool.query('select use_count from server_invite_links where id=$1', [fresh.value.inviteLink.id])).rows[0].use_count, 0);

      const blocker = await pool.connect();
      try {
        await blocker.query('begin');
        await blocker.query('select 1 from servers where id=$1 for update', [server]);
        const pause = setServerInvitesPaused(database, server, owner, true);
        await new Promise((resolve) => setTimeout(resolve, 20));
        const join = joinServerViaInviteLink(database, fresh.value.token, late, keys);
        await new Promise((resolve) => setTimeout(resolve, 20));
        await blocker.query('commit');
        assert.deepEqual(await pause, { value: { paused: true } });
        assert.deepEqual(await join, { denied: 'unavailable' });
      } finally { await blocker.query('rollback').catch(() => {}); blocker.release(); }
      assert.equal((await pool.query('select use_count from server_invite_links where id=$1', [fresh.value.inviteLink.id])).rows[0].use_count, 0);
      await setServerInvitesPaused(database, server, owner, false);
      const edited = await updateServerInviteLink(database, server, fresh.value.inviteLink.id, owner, { maxUses: 1 });
      assert.ok('value' in edited);
      assert.ok('value' in await joinServerViaInviteLink(database, fresh.value.token, late, keys));
      assert.equal((await pool.query('select use_count from server_invite_links where id=$1', [fresh.value.inviteLink.id])).rows[0].use_count, 1);
      const editRace = await createServerInviteLink(database, server, owner, keys);
      assert.ok('value' in editRace);
      const editBlocker = await pool.connect();
      try {
        await editBlocker.query('begin');
        await editBlocker.query('select 1 from servers where id=$1 for update', [server]);
        const edit = updateServerInviteLink(database, server, editRace.value.inviteLink.id, owner, { maxUses: 1 });
        await new Promise((resolve) => setTimeout(resolve, 20));
        const join = joinServerViaInviteLink(database, editRace.value.token, editActor, keys);
        await new Promise((resolve) => setTimeout(resolve, 20));
        await editBlocker.query('commit');
        assert.ok('value' in await edit);
        assert.ok('value' in await join);
      } finally { await editBlocker.query('rollback').catch(() => {}); editBlocker.release(); }
      assert.deepEqual((await pool.query('select use_count,max_uses from server_invite_links where id=$1', [editRace.value.inviteLink.id])).rows[0],
        { use_count: 1, max_uses: 1 });
    } finally {
      await pool.query('delete from servers where id=$1', [server]).catch(() => {});
      await pool.query('delete from users where id=any($1::uuid[])', [ids]).catch(() => {});
      await pool.end();
    }
  });
