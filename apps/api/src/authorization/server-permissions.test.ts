import assert from 'node:assert/strict';
import test from 'node:test';
import { SERVER_PERMISSION_BITS, parseServerPermissionName } from '@cubic/shared';
import {
  ALL_SERVER_PERMISSIONS, DEFAULT_SERVER_PERMISSIONS, canActOnServerMember,
  getEffectiveServerPermissions, getHighestRolePosition, hasServerPermission, serverPermissionMask, serverPermissionNames,
  type ServerAuthority, type ServerPermissionExecutor
} from './server-permissions.js';

function authority(userId: string, position: number, permissions: bigint, isOwner = false): ServerAuthority {
  return { serverId: 'server-a', userId, isOwner, highestRolePosition: position, effectivePermissions: permissions };
}

test('server permission names have fixed distinct bits and unknown names fail closed', () => {
  assert.deepEqual(Object.values(SERVER_PERMISSION_BITS), Array.from({ length: 13 }, (_, index) => index));
  for (const [name, bit] of Object.entries(SERVER_PERMISSION_BITS)) {
    assert.equal(serverPermissionMask([name]), 1n << BigInt(bit));
    assert.deepEqual(serverPermissionNames(1n << BigInt(bit)), [name]);
  }
  assert.equal(parseServerPermissionName('KICK_MEMBERS'), 'KICK_MEMBERS');
  assert.equal(parseServerPermissionName('MANAGE_INVITES'), 'MANAGE_INVITES');
  assert.equal(parseServerPermissionName('CREATE_INVITES'), null);
  assert.equal(parseServerPermissionName('ADMINISTRATOR'), null);
  assert.equal(serverPermissionMask(['VIEW_SERVER', 'VIEW_SERVER']), 1n);
  assert.equal(serverPermissionMask(['VIEW_SERVER', 'NOT_REAL']), null);
  assert.equal(serverPermissionMask(['VIEW_SERVER', 3]), null);
  assert.equal(ALL_SERVER_PERMISSIONS, 8191n);
  assert.equal(DEFAULT_SERVER_PERMISSIONS, 8001n);
  assert.deepEqual(serverPermissionNames(DEFAULT_SERVER_PERMISSIONS),
    ['VIEW_SERVER', 'SEND_MESSAGES', 'CONNECT', 'SPEAK', 'VIDEO', 'SCREEN_SHARE', 'VIEW_CHANNEL']);
  assert.deepEqual(serverPermissionNames(1n | (1n << 11n)), ['VIEW_SERVER', 'SCREEN_SHARE']);
  assert.throws(() => serverPermissionNames(1n << 13n), /Unknown server permission bits/);
  assert.throws(() => serverPermissionNames(1n << 53n), /Unknown server permission bits/);
  assert.throws(() => serverPermissionNames(-1n), /Unknown server permission bits/);
  assert.equal(serverPermissionNames(ALL_SERVER_PERMISSIONS).length, 13);
  assert.equal(JSON.stringify({ permissions: serverPermissionNames(DEFAULT_SERVER_PERMISSIONS) }).includes('VIEW_SERVER'), true);
});

test('invalid database masks reject authorization before a JSON boundary', async () => {
  for (const permissions_mask of ['8192', '9007199254740992', '-1', 'not-a-mask']) {
    const executor = { query: async () => ({ rows: [{ owner_user_id: 'other', permissions_mask, highest_position: 0 }] }) } as unknown as ServerPermissionExecutor;
    await assert.rejects(getEffectiveServerPermissions(executor, 'server-a', 'member'), /Invalid server permission mask|Unknown server permission bits/);
  }
});

test('permission checks and hierarchy deny equality, higher targets and cross-server action', () => {
  const kick = serverPermissionMask(['KICK_MEMBERS'])!;
  const low = authority('low', 1, kick);
  const equal = authority('equal', 1, 0n);
  const high = authority('high', 2, kick);
  const defaultMember = authority('default', 0, DEFAULT_SERVER_PERMISSIONS);
  const owner = authority('owner', 0, ALL_SERVER_PERMISSIONS, true);
  assert.equal(hasServerPermission(low, 'KICK_MEMBERS'), true);
  assert.equal(hasServerPermission(defaultMember, 'KICK_MEMBERS'), false);
  assert.equal(hasServerPermission(owner, 'NOT_REAL'), false);
  assert.equal(getHighestRolePosition(defaultMember), 0);
  assert.equal(getHighestRolePosition(high), 2);
  assert.equal(canActOnServerMember(low, equal, 'KICK_MEMBERS'), false);
  assert.equal(canActOnServerMember(low, high, 'KICK_MEMBERS'), false);
  assert.equal(canActOnServerMember(high, low, 'KICK_MEMBERS'), true);
  assert.equal(canActOnServerMember(owner, high, 'KICK_MEMBERS'), true);
  assert.equal(canActOnServerMember(owner, owner, 'KICK_MEMBERS'), false);
  assert.equal(canActOnServerMember(high, owner, 'KICK_MEMBERS'), false);
  assert.equal(canActOnServerMember({ ...high, serverId: 'server-b' }, low, 'KICK_MEMBERS'), false);
  assert.equal(canActOnServerMember(authority('no-permission', 3, 0n), low, 'KICK_MEMBERS'), false);
});
