import assert from 'node:assert/strict';
import test from 'node:test';
import type { Database } from '@cubic/database';
import { createOwnedServer } from './store.js';

test('failed creator membership insert rolls back server creation and releases the client', async () => {
  const queries: string[] = [];
  let released = false;
  const database = {
    pool: {
      connect: async () => ({
        query: async (sql: string) => {
          queries.push(sql);
          if (sql.startsWith('insert into servers')) return { rows: [{ id: 'server-id' }] };
          if (sql.startsWith('insert into server_members')) throw new Error('membership unavailable');
          return { rows: [] };
        },
        release: () => { released = true; }
      })
    }
  } as unknown as Database;

  await assert.rejects(createOwnedServer(database, 'authenticated-user', 'Aurora'), /membership unavailable/);
  assert.deepEqual(queries.map((query) => query.trim().split(/\s+/u).slice(0, 3).join(' ')), [
    'begin', 'insert into servers', 'insert into server_members', 'rollback'
  ]);
  assert.equal(released, true);
  assert.equal(queries.includes('commit'), false);
});
