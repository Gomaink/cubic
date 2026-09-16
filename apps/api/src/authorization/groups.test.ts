import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canChangeGroupRole,
  canDeleteGroup,
  canManageGroup,
  canRemoveGroupMember,
  canTransferGroupOwnership,
  parseGroupRole,
  resolveGroupMembership
} from './groups.js';

const conversationId = '20000000-0000-4000-8000-000000000001';
const actorId = '10000000-0000-4000-8000-000000000001';

class GroupAuthorizationDatabase {
  row: Record<string, unknown> | null = {
    id: conversationId,
    title: 'Cubic group',
    created_by: actorId,
    avatar_key: null,
    role: 'owner'
  };
  failure: Error | null = null;

  async query(_sql: string, params: unknown[]) {
    if (this.failure) throw this.failure;
    const rows = params[0] === conversationId && params[1] === actorId && this.row
      ? [this.row]
      : [];
    return { rows, rowCount: rows.length };
  }
}

test('group roles parse structurally and unknown values fail closed', () => {
  assert.equal(parseGroupRole('owner'), 'owner');
  assert.equal(parseGroupRole('admin'), 'admin');
  assert.equal(parseGroupRole('member'), 'member');
  assert.equal(parseGroupRole('moderator'), null);
  assert.equal(parseGroupRole(null), null);
  assert.equal(parseGroupRole({ role: 'owner' }), null);
});

test('group membership resolves current members and denies outsiders or missing groups equivalently', async () => {
  const database = new GroupAuthorizationDatabase();
  assert.deepEqual(
    await resolveGroupMembership(database as never, conversationId, actorId),
    {
      conversationId,
      avatarKey: null,
      role: 'owner'
    }
  );

  assert.equal(
    await resolveGroupMembership(database as never, conversationId, '10000000-0000-4000-8000-000000000099'),
    null
  );
  assert.equal(
    await resolveGroupMembership(database as never, '20000000-0000-4000-8000-000000000099', actorId),
    null
  );

  database.row = { ...database.row, role: 'moderator' };
  assert.equal(await resolveGroupMembership(database as never, conversationId, actorId), null);
});

test('group management and owner-only capabilities preserve the current role matrix', () => {
  assert.equal(canManageGroup('owner'), true);
  assert.equal(canManageGroup('admin'), true);
  assert.equal(canManageGroup('member'), false);

  assert.equal(canTransferGroupOwnership('owner'), true);
  assert.equal(canTransferGroupOwnership('admin'), false);
  assert.equal(canTransferGroupOwnership('member'), false);
  assert.equal(canDeleteGroup('owner'), true);
  assert.equal(canDeleteGroup('admin'), false);
  assert.equal(canDeleteGroup('member'), false);
});

test('only owners change non-owner roles', () => {
  assert.equal(canChangeGroupRole('owner', 'member'), true);
  assert.equal(canChangeGroupRole('owner', 'admin'), true);
  assert.equal(canChangeGroupRole('owner', 'owner'), false);
  assert.equal(canChangeGroupRole('admin', 'member'), false);
  assert.equal(canChangeGroupRole('member', 'member'), false);
});

test('owners remove admins or members while admins remove only members', () => {
  assert.equal(canRemoveGroupMember('owner', 'admin'), true);
  assert.equal(canRemoveGroupMember('owner', 'member'), true);
  assert.equal(canRemoveGroupMember('owner', 'owner'), false);
  assert.equal(canRemoveGroupMember('admin', 'member'), true);
  assert.equal(canRemoveGroupMember('admin', 'admin'), false);
  assert.equal(canRemoveGroupMember('admin', 'owner'), false);
  assert.equal(canRemoveGroupMember('member', 'member'), false);
});

test('database failures propagate instead of becoming authorization decisions', async () => {
  const database = new GroupAuthorizationDatabase();
  database.failure = new Error('database unavailable');
  await assert.rejects(
    resolveGroupMembership(database as never, conversationId, actorId),
    /database unavailable/
  );
});
