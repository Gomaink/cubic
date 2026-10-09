import assert from 'node:assert/strict';
import test from 'node:test';
import { ALL_SERVER_PERMISSIONS, DEFAULT_SERVER_PERMISSIONS, serverPermissionMask } from './server-permissions.js';
import { CHANNEL_OVERRIDE_MASK, VOICE_CHANNEL_OVERRIDE_MASK, hasChannelPermission, resolveChannelPermissionMask } from './channel-permissions.js';

const serverId = '10000000-0000-4000-8000-000000000001';
const userId = '20000000-0000-4000-8000-000000000001';
const roleA = '30000000-0000-4000-8000-000000000001';
const roleB = '30000000-0000-4000-8000-000000000002';
const view = serverPermissionMask(['VIEW_CHANNEL'])!;
const send = serverPermissionMask(['SEND_MESSAGES'])!;
function row(role_id: string | null, member_user_id: string | null, allow: bigint, deny: bigint) {
  return { channel_id: 'channel', role_id, member_user_id, allow_mask: allow.toString(), deny_mask: deny.toString() };
}

test('channel resolution applies default, combined roles, then member; allow wins within each stage', () => {
  assert.equal(resolveChannelPermissionMask(DEFAULT_SERVER_PERMISSIONS, serverId, userId, []), DEFAULT_SERVER_PERMISSIONS);
  assert.equal(CHANNEL_OVERRIDE_MASK, 65472n);
  assert.equal(VOICE_CHANNEL_OVERRIDE_MASK, 8128n);
  assert.equal(hasChannelPermission(resolveChannelPermissionMask(DEFAULT_SERVER_PERMISSIONS, serverId, userId,
    [row(serverId, null, 0n, view)]), 'VIEW_CHANNEL'), false);
  assert.equal(hasChannelPermission(resolveChannelPermissionMask(0n, serverId, userId,
    [row(serverId, null, view, 0n)]), 'VIEW_CHANNEL'), true);
  const combined = resolveChannelPermissionMask(DEFAULT_SERVER_PERMISSIONS, serverId, userId, [
    row(serverId, null, 0n, view),
    row(roleA, null, view, send),
    row(roleB, null, send, view)
  ]);
  assert.equal(hasChannelPermission(combined, 'VIEW_CHANNEL'), true);
  assert.equal(hasChannelPermission(combined, 'SEND_MESSAGES'), true);
  const memberDenied = resolveChannelPermissionMask(DEFAULT_SERVER_PERMISSIONS, serverId, userId,
    [row(roleA, null, view, 0n), row(null, userId, 0n, view)]);
  assert.equal(hasChannelPermission(memberDenied, 'VIEW_CHANNEL'), false);
  const memberAllowed = resolveChannelPermissionMask(0n, serverId, userId,
    [row(roleA, null, 0n, view), row(null, userId, view, 0n)]);
  assert.equal(hasChannelPermission(memberAllowed, 'VIEW_CHANNEL'), true);
  assert.equal(resolveChannelPermissionMask(0n, serverId, userId, [row(serverId, null, 0n, view)], true), ALL_SERVER_PERMISSIONS);
});

test('unknown or overlapping override bits fail closed', () => {
  assert.throws(() => resolveChannelPermissionMask(0n, serverId, userId, [row(roleA, null, 65536n, 0n)]), /Unknown/);
  assert.throws(() => resolveChannelPermissionMask(0n, serverId, userId, [row(roleA, null, view, view)]), /Overlapping/);
  assert.equal(hasChannelPermission(DEFAULT_SERVER_PERMISSIONS, 'NOT_REAL'), false);
  assert.equal(hasChannelPermission(ALL_SERVER_PERMISSIONS, 'MANAGE_SERVER'), false);
});

test('mention override bits resolve in text channels only, with existing layer precedence', () => {
  const everyone = serverPermissionMask(['MENTION_EVERYONE'])!;
  const here = serverPermissionMask(['MENTION_HERE'])!;
  const roles = serverPermissionMask(['MENTION_ROLES'])!;
  const combined = resolveChannelPermissionMask(everyone | here, serverId, userId, [
    row(serverId, null, roles, everyone | here),
    row(roleA, null, everyone, roles),
    row(roleB, null, roles, everyone),
    row(null, userId, here, roles)
  ]);
  assert.equal(hasChannelPermission(combined, 'MENTION_EVERYONE'), true);
  assert.equal(hasChannelPermission(combined, 'MENTION_HERE'), true);
  assert.equal(hasChannelPermission(combined, 'MENTION_ROLES'), false);
  assert.equal(hasChannelPermission(DEFAULT_SERVER_PERMISSIONS, 'MENTION_EVERYONE'), false);
  assert.equal(resolveChannelPermissionMask(0n, serverId, userId, [row(serverId, null, everyone, 0n)], true), ALL_SERVER_PERMISSIONS);
  assert.throws(() => resolveChannelPermissionMask(0n, serverId, userId, [row(roleA, null, everyone, 0n)], false, 'voice'), /Unknown/);
});
