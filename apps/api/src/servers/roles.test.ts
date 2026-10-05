import assert from 'node:assert/strict';
import test from 'node:test';
import type { Database } from '@cubic/database';
import { assignCustomRole, createCustomRole } from './roles.js';

test('role writes roll back and propagate database uncertainty', async () => {
  const statements: string[] = [];
  const failure = new Error('database unavailable');
  const database = { pool: { connect: async () => ({
    query: async (statement: string) => {
      statements.push(statement);
      if (statement.startsWith('select 1 from servers')) throw failure;
      return { rows: [], rowCount: 0 };
    },
    release: () => { statements.push('release'); }
  }) } } as unknown as Database;
  await assert.rejects(createCustomRole(database, 'server-id', 'actor-id', 'Helpers'), (error: unknown) => error === failure);
  assert.deepEqual(statements, ['begin', 'select 1 from servers where id = $1 for update', 'rollback', 'release']);
});

test('an owner cannot assign a role with unknown stored permission bits', async () => {
  const statements: string[] = [];
  const database = { pool: { connect: async () => ({
    query: async (statement: string) => {
      statements.push(statement);
      if (statement.startsWith('select 1 from servers')) return { rows: [{}], rowCount: 1 };
      if (statement.includes('from servers s')) return { rows: [{ owner_user_id: 'owner-id', permissions_mask: '8001', highest_position: 0 }], rowCount: 1 };
      if (statement.includes('from server_roles where')) return { rows: [{ position: 1, permissions: '8192' }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    },
    release: () => {}
  }) } } as unknown as Database;
  await assert.rejects(assignCustomRole(database, 'server-id', 'owner-id', 'member-id', 'role-id'), /Unknown server permission bits/);
  assert.ok(statements.includes('rollback'));
  assert.equal(statements.some((statement) => statement.includes('insert into server_member_roles')), false);
});
