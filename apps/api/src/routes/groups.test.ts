import assert from 'node:assert/strict';
import test from 'node:test';
import { canChangeGroupRole, canManageGroup, canRemoveGroupMember, withGroupLock } from './groups.js';

test('group management permission matrix', () => {
  assert.equal(canManageGroup('owner'), true);
  assert.equal(canManageGroup('admin'), true);
  assert.equal(canManageGroup('member'), false);
});

test('only owners can promote or demote non-owners', () => {
  assert.equal(canChangeGroupRole('owner', 'member'), true);
  assert.equal(canChangeGroupRole('owner', 'admin'), true);
  assert.equal(canChangeGroupRole('owner', 'owner'), false);
  assert.equal(canChangeGroupRole('admin', 'member'), false);
});

test('owner can remove admins/members while admins can only remove members', () => {
  assert.equal(canRemoveGroupMember('owner', 'admin'), true);
  assert.equal(canRemoveGroupMember('owner', 'member'), true);
  assert.equal(canRemoveGroupMember('admin', 'member'), true);
  assert.equal(canRemoveGroupMember('admin', 'admin'), false);
  assert.equal(canRemoveGroupMember('member', 'member'), false);
  assert.equal(canRemoveGroupMember('owner', 'owner'), false);
});


test('group mutation lock serializes the critical section inside one transaction', async () => {
  const calls: string[] = [];
  const client = {
    async query(sql: string) {
      calls.push(sql);
      return { rows: [], rowCount: 0 };
    },
    release() { calls.push('release'); }
  };
  const database = { pool: { async connect() { return client; } } } as never;

  await withGroupLock(database, '00000000-0000-4000-8000-000000000001', async () => {
    calls.push('action');
    return 'ok';
  });

  assert.equal(calls[0], 'begin');
  assert.match(calls[1] ?? '', /pg_advisory_xact_lock/);
  assert.equal(calls[2], 'action');
  assert.equal(calls[3], 'commit');
  assert.equal(calls[4], 'release');
});

test('group mutation lock rolls back and releases on failure', async () => {
  const calls: string[] = [];
  const client = {
    async query(sql: string) {
      calls.push(sql);
      return { rows: [], rowCount: 0 };
    },
    release() { calls.push('release'); }
  };
  const database = { pool: { async connect() { return client; } } } as never;

  await assert.rejects(() => withGroupLock(database, '00000000-0000-4000-8000-000000000001', async () => {
    calls.push('action');
    throw new Error('boom');
  }));

  assert.ok(calls.includes('rollback'));
  assert.equal(calls.at(-1), 'release');
});
