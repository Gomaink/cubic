import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Pool } from 'pg';
import type { Database } from '@cubic/database';
import { assignCustomRole, createCustomRole } from '../servers/roles.js';
import { createOwnedServer } from '../servers/store.js';
import {
  ALL_SERVER_PERMISSIONS, DEFAULT_SERVER_PERMISSIONS, canActOnServerMember,
  getEffectiveServerPermissions, hasServerPermission, requireServerPermission,
  serverPermissionMask, serverPermissionNames
} from './server-permissions.js';

const connectionString = process.env.CUBIC_SERVER_TEST_DATABASE_URL;

test('PostgreSQL permission aggregation, default changes, owner bypass, and hierarchy stay server-scoped',
  { skip: !connectionString, timeout: 30_000 }, async () => {
    const pool = new Pool({ connectionString, max: 5 });
    const database = { pool } as Database;
    const owner = randomUUID(), low = randomUUID(), high = randomUUID(), outsider = randomUUID();
    const users = [owner, low, high, outsider];
    const serverIds: string[] = [];
    try {
      for (const [index, id] of users.entries()) {
        await pool.query(
          `insert into users (id,email,email_normalized,username,username_normalized,display_name,password_hash)
           values ($1,$2,$2,$3,$3,$4,'proof')`,
          [id, `${id}@integration.invalid`, `permission_${index}_${id.slice(0, 8)}`, `Permission ${index}`]
        );
      }
      const first = await createOwnedServer(database, owner, 'Permissions one');
      const second = await createOwnedServer(database, owner, 'Permissions two');
      serverIds.push(first.id, second.id);
      await pool.query('insert into server_members (server_id,user_id) values ($1,$2),($1,$3),($4,$5)',
        [first.id, low, high, second.id, outsider]);

      const defaultRole = (await pool.query('select permissions from server_roles where id=$1', [first.id])).rows[0];
      assert.equal(BigInt(defaultRole.permissions), DEFAULT_SERVER_PERMISSIONS);
      assert.equal((await pool.query('select permissions from server_roles where id=$1', [second.id])).rows[0].permissions, defaultRole.permissions);
      const lowInitial = await getEffectiveServerPermissions(pool, first.id, low);
      assert.ok(lowInitial);
      assert.equal(lowInitial.effectivePermissions, DEFAULT_SERVER_PERMISSIONS);
      assert.equal(lowInitial.effectivePermissions & serverPermissionMask(['MENTION_EVERYONE', 'MENTION_HERE', 'MENTION_ROLES'])!, 0n);
      assert.equal(lowInitial.highestRolePosition, 0);
      assert.equal(await getEffectiveServerPermissions(pool, first.id, outsider), null);
      assert.deepEqual(await requireServerPermission(pool, first.id, outsider, 'MANAGE_INVITES'), { denied: 'not_found' });
      assert.deepEqual(await requireServerPermission(pool, first.id, low, 'MANAGE_INVITES'), { denied: 'forbidden' });
      assert.deepEqual(await requireServerPermission(pool, first.id, low, 'UNKNOWN'), { denied: 'forbidden' });

      const manage = await createCustomRole(database, first.id, owner, 'Manage');
      const kick = await createCustomRole(database, first.id, owner, 'Kick');
      const foreign = await createCustomRole(database, second.id, owner, 'Foreign');
      assert.ok('value' in manage && 'value' in kick && 'value' in foreign);
      if (!('value' in manage && 'value' in kick && 'value' in foreign)) throw new Error('Role creation failed');
      await pool.query('update server_roles set permissions=$2, updated_at=now() where id=$1',
        [manage.value.id, serverPermissionMask(['MANAGE_INVITES'])!.toString()]);
      await pool.query('update server_roles set permissions=$2, updated_at=now() where id=$1',
        [kick.value.id, serverPermissionMask(['KICK_MEMBERS'])!.toString()]);
      await pool.query('update server_roles set permissions=$2 where id=$1',
        [foreign.value.id, serverPermissionMask(['MANAGE_SERVER'])!.toString()]);
      assert.deepEqual(await assignCustomRole(database, first.id, owner, low, manage.value.id), { value: true });
      assert.deepEqual(await assignCustomRole(database, first.id, owner, low, manage.value.id), { value: false });
      assert.deepEqual(await assignCustomRole(database, first.id, owner, low, kick.value.id), { value: true });
      assert.deepEqual(await assignCustomRole(database, first.id, owner, low, foreign.value.id), { denied: 'invalid_role' });

      const aggregated = await getEffectiveServerPermissions(pool, first.id, low);
      assert.ok(aggregated);
      assert.equal(aggregated.effectivePermissions, DEFAULT_SERVER_PERMISSIONS | serverPermissionMask(['MANAGE_INVITES', 'KICK_MEMBERS'])!);
      assert.equal(aggregated.highestRolePosition, kick.value.position);
      assert.equal(hasServerPermission(aggregated, 'MANAGE_INVITES'), true);
      assert.equal(hasServerPermission(aggregated, 'MANAGE_SERVER'), false);
      assert.equal(JSON.stringify({ permissions: serverPermissionNames(aggregated.effectivePermissions) }).includes('MANAGE_INVITES'), true);
      assert.equal('value' in await requireServerPermission(pool, first.id, low, 'MANAGE_INVITES'), true);

      await pool.query('update server_roles set permissions=$2, updated_at=now() where id=$1', [first.id, '0']);
      assert.equal((await getEffectiveServerPermissions(pool, first.id, high))?.effectivePermissions, 0n);
      assert.equal((await getEffectiveServerPermissions(pool, first.id, low))?.effectivePermissions,
        serverPermissionMask(['MANAGE_INVITES', 'KICK_MEMBERS']));
      assert.equal((await getEffectiveServerPermissions(pool, second.id, outsider))?.effectivePermissions, DEFAULT_SERVER_PERMISSIONS);
      const ownerAuthority = await getEffectiveServerPermissions(pool, first.id, owner);
      assert.ok(ownerAuthority);
      assert.equal(ownerAuthority.isOwner, true);
      assert.equal(ownerAuthority.effectivePermissions, ALL_SERVER_PERMISSIONS);
      assert.equal((await pool.query('select 1 from server_member_roles where user_id=$1', [owner])).rowCount, 0);

      const highAuthority = await getEffectiveServerPermissions(pool, first.id, high);
      assert.ok(highAuthority);
      assert.equal(canActOnServerMember(aggregated, highAuthority, 'KICK_MEMBERS'), true);
      assert.equal(canActOnServerMember(highAuthority, aggregated, 'KICK_MEMBERS'), false);
      assert.equal(canActOnServerMember(ownerAuthority, aggregated, 'KICK_MEMBERS'), true);
      assert.equal(canActOnServerMember(aggregated, ownerAuthority, 'KICK_MEMBERS'), false);
      const foreignAuthority = await getEffectiveServerPermissions(pool, second.id, outsider);
      assert.ok(foreignAuthority);
      assert.equal(canActOnServerMember(aggregated, foreignAuthority, 'KICK_MEMBERS'), false);
      await pool.query('update servers set owner_user_id=$2 where id=$1', [first.id, high]);
      assert.equal((await getEffectiveServerPermissions(pool, first.id, high))?.effectivePermissions, ALL_SERVER_PERMISSIONS);
      assert.equal((await getEffectiveServerPermissions(pool, first.id, owner))?.isOwner, false);
      await pool.query('update servers set owner_user_id=$2 where id=$1', [first.id, owner]);
      await assert.rejects(pool.query('update server_roles set permissions=$2 where id=$1', [first.id, '65536']),
        (error: any) => error.code === '23514');
      await assert.rejects(pool.query('update server_roles set permissions=$2 where id=$1', [first.id, '-1']),
        (error: any) => error.code === '23514');
      await assert.rejects(pool.query('update server_roles set permissions=$2 where id=$1', [first.id, '9007199254740992']),
        (error: any) => error.code === '23514');
      await pool.query('update server_roles set permissions=$2 where id=$1', [foreign.value.id, '65535']);
      assert.equal((await pool.query('select permissions from server_roles where id=$1', [foreign.value.id])).rows[0].permissions, '65535');
    } finally {
      await pool.query('delete from servers where id=any($1::uuid[])', [serverIds]).catch(() => {});
      await pool.query('delete from users where id=any($1::uuid[])', [users]).catch(() => {});
      await pool.end();
    }
  });
