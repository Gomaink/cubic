import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Pool } from 'pg';
import { getEffectiveChannelPermissions, hasChannelPermission } from './channel-permissions.js';

const connectionString = process.env.CUBIC_SERVER_TEST_DATABASE_URL ?? process.env.CUBIC_GROUP_TEST_DATABASE_URL;

test('channel overrides enforce same-server targets, masks, uniqueness, resolution and cascades in PostgreSQL',
  { skip: !connectionString, timeout: 30_000 }, async () => {
    const pool = new Pool({ connectionString });
    const owner = randomUUID(), member = randomUUID(), foreignMember = randomUUID();
    const server = randomUUID(), foreignServer = randomUUID(), channel = randomUUID();
    const role = randomUUID(), foreignRole = randomUUID(), suffix = owner.replaceAll('-', '').slice(0, 20);
    const insertOverride = async (targetRole: string | null, targetMember: string | null, allow: number, deny: number, targetServer = server) =>
      pool.query(`insert into server_channel_overrides(server_id,voice_channel_id,role_id,member_user_id,allow,deny)
        values($1,$2,$3,$4,$5,$6) returning id`, [targetServer, channel, targetRole, targetMember, allow, deny]);
    try {
      for (const [index, id] of [owner, member, foreignMember].entries()) {
        await pool.query(`insert into users(id,email,email_normalized,username,username_normalized,display_name,password_hash)
          values($1,$2,$2,$3,$3,$4,'fixture')`, [id, `${index}-${suffix}@example.invalid`, `override_${index}_${suffix}`, 'Override']);
      }
      await pool.query('insert into servers(id,name,owner_user_id) values($1,$2,$3),($4,$2,$3)',
        [server, 'Override', owner, foreignServer]);
      await pool.query('insert into server_members(server_id,user_id) values($1,$2),($1,$3),($4,$2),($4,$5)',
        [server, owner, member, foreignServer, foreignMember]);
      await pool.query('insert into server_voice_channels(id,server_id,name) values($1,$2,$3)', [channel, server, 'Voice']);
      await pool.query('insert into server_roles(id,server_id,name,position,permissions) values($1,$2,$3,1,0),($4,$5,$6,1,0)',
        [role, server, 'Local', foreignRole, foreignServer, 'Foreign']);
      await pool.query('insert into server_member_roles(server_id,user_id,role_id) values($1,$2,$3)', [server, member, role]);

      assert.equal(hasChannelPermission((await getEffectiveChannelPermissions(pool, server, member, 'voice', channel))!, 'VIEW_CHANNEL'), true);
      assert.equal(await getEffectiveChannelPermissions(pool, server, foreignMember, 'voice', channel), null);
      assert.equal(await getEffectiveChannelPermissions(pool, foreignServer, member, 'voice', channel), null);
      assert.equal(await getEffectiveChannelPermissions(pool, server, member, 'voice', randomUUID()), null);
      const everyone = (await insertOverride(server, null, 0, 4096)).rows[0].id;
      assert.equal(hasChannelPermission((await getEffectiveChannelPermissions(pool, server, member, 'voice', channel))!, 'VIEW_CHANNEL'), false);
      const roleOverride = (await insertOverride(role, null, 4096, 0)).rows[0].id;
      assert.equal(hasChannelPermission((await getEffectiveChannelPermissions(pool, server, member, 'voice', channel))!, 'VIEW_CHANNEL'), true);
      const memberOverride = (await insertOverride(null, member, 0, 4096)).rows[0].id;
      assert.equal(hasChannelPermission((await getEffectiveChannelPermissions(pool, server, member, 'voice', channel))!, 'VIEW_CHANNEL'), false);
      assert.equal(hasChannelPermission((await getEffectiveChannelPermissions(pool, server, owner, 'voice', channel))!, 'VIEW_CHANNEL'), true);

      await assert.rejects(insertOverride(role, null, 0, 0), (error: any) => error.code === '23505');
      await assert.rejects(insertOverride(foreignRole, null, 0, 0), (error: any) => error.code === '23503');
      await assert.rejects(insertOverride(null, foreignMember, 0, 0), (error: any) => error.code === '23503');
      await assert.rejects(insertOverride(role, null, 4096, 4096), (error: any) => error.code === '23514');
      await assert.rejects(insertOverride(role, null, 8192, 0), (error: any) => error.code === '23514');
      await assert.rejects(insertOverride(role, null, 65536, 0), (error: any) => error.code === '23514');
      await assert.rejects(insertOverride(null, null, 0, 0), (error: any) => error.code === '23514');
      await assert.rejects(insertOverride(role, member, 0, 0), (error: any) => error.code === '23514');
      await assert.rejects(pool.query(`insert into server_channel_overrides(server_id,voice_channel_id,role_id)
        values($1,$2,$3)`, [foreignServer, channel, foreignServer]), (error: any) => error.code === '23503');

      await pool.query('delete from server_roles where id=$1', [role]);
      assert.equal((await pool.query('select count(*)::int n from server_channel_overrides where id=$1', [roleOverride])).rows[0].n, 0);
      await pool.query('delete from server_members where server_id=$1 and user_id=$2', [server, member]);
      assert.equal((await pool.query('select count(*)::int n from server_channel_overrides where id=$1', [memberOverride])).rows[0].n, 0);
      await pool.query('delete from server_voice_channels where id=$1', [channel]);
      assert.equal((await pool.query('select count(*)::int n from server_channel_overrides where id=$1', [everyone])).rows[0].n, 0);
      const remainingChannel = randomUUID();
      await pool.query('insert into server_voice_channels(id,server_id,name) values($1,$2,$3)', [remainingChannel, server, 'Remaining']);
      const serverCascade = await pool.query(`insert into server_channel_overrides(server_id,voice_channel_id,role_id,deny)
        values($1,$2,$1,4096) returning id`, [server, remainingChannel]);
      await pool.query('delete from servers where id=$1', [server]);
      assert.equal((await pool.query('select count(*)::int n from server_channel_overrides where id=$1', [serverCascade.rows[0].id])).rows[0].n, 0);
    } finally {
      await pool.query('delete from server_voice_channels where id=$1', [channel]);
      await pool.query('delete from servers where id=$1 or id=$2', [server, foreignServer]);
      await pool.query('delete from users where id=any($1::uuid[])', [[owner, member, foreignMember]]);
      await pool.end();
    }
  });
