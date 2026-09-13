import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AttachmentCleanupScheduler,
  cleanupStalePendingBatch
} from './attachment-cleanup.js';

type CleanupRow = {
  id: string;
  storage_key: string;
  message_id: string | null;
  created_at: Date;
};

class CleanupDatabase {
  locked = true;
  rows: CleanupRow[];

  constructor(rows: CleanupRow[]) {
    this.rows = rows;
  }

  pool = {
    connect: async () => ({
      query: async (sql: string, params: any[] = []) => {
        const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();
        if (normalized === 'begin' || normalized === 'commit' || normalized === 'rollback') {
          return { rows: [], rowCount: 0 };
        }
        if (normalized.includes('pg_try_advisory_xact_lock')) {
          return { rows: [{ acquired: this.locked }], rowCount: 1 };
        }
        if (normalized.startsWith('select id, storage_key from attachments')) {
          const cutoff = params[0] as Date;
          const batchSize = params[1] as number;
          const rows = this.rows
            .filter((row) => row.message_id === null && row.created_at < cutoff)
            .sort((left, right) => left.created_at.getTime() - right.created_at.getTime())
            .slice(0, batchSize);
          return { rows, rowCount: rows.length };
        }
        if (normalized.startsWith('delete from attachments')) {
          const ids = new Set(params[0] as string[]);
          const before = this.rows.length;
          this.rows = this.rows.filter((row) => !ids.has(row.id) || row.message_id !== null);
          return { rows: [], rowCount: before - this.rows.length };
        }
        throw new Error(`Unexpected cleanup SQL: ${normalized}`);
      },
      release() {}
    })
  };
}

const now = new Date('2026-09-13T12:00:00.000Z');
const old = new Date('2026-09-11T12:00:00.000Z');
const recent = new Date('2026-09-13T11:30:00.000Z');

function row(id: string, createdAt: Date, messageId: string | null = null): CleanupRow {
  return { id, storage_key: id, message_id: messageId, created_at: createdAt };
}

function logger() {
  return { warnings: [] as unknown[], errors: [] as unknown[],
    warn(bindings: unknown) { this.warnings.push(bindings); },
    error(bindings: unknown) { this.errors.push(bindings); }
  };
}

test('cleanup deletes only stale pending attachments and preserves recent or bound rows', async () => {
  const database = new CleanupDatabase([
    row('00000000-0000-4000-8000-000000000001', old),
    row('00000000-0000-4000-8000-000000000002', recent),
    row('00000000-0000-4000-8000-000000000003', old, 'bound-message')
  ]);
  const deletedKeys: string[] = [];

  const result = await cleanupStalePendingBatch({
    database: database as never,
    attachmentStore: { delete: async (key: string) => { deletedKeys.push(key); } } as never,
    staleAgeMs: 24 * 60 * 60 * 1000,
    batchSize: 10,
    logger: logger(),
    now
  });

  assert.deepEqual(result, { lockAcquired: true, selected: 1, deleted: 1, failed: 0 });
  assert.deepEqual(deletedKeys, ['00000000-0000-4000-8000-000000000001']);
  assert.deepEqual(database.rows.map((item) => item.id), [
    '00000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000003'
  ]);
});

test('cleanup drains a backlog over bounded batch iterations', async () => {
  const database = new CleanupDatabase([
    row('00000000-0000-4000-8000-000000000001', old),
    row('00000000-0000-4000-8000-000000000002', old),
    row('00000000-0000-4000-8000-000000000003', old)
  ]);
  const store = { delete: async () => {} };

  const first = await cleanupStalePendingBatch({
    database: database as never,
    attachmentStore: store as never,
    staleAgeMs: 1,
    batchSize: 2,
    logger: logger(),
    now
  });
  const second = await cleanupStalePendingBatch({
    database: database as never,
    attachmentStore: store as never,
    staleAgeMs: 1,
    batchSize: 2,
    logger: logger(),
    now
  });

  assert.equal(first.deleted, 2);
  assert.equal(second.deleted, 1);
  assert.equal(database.rows.length, 0);
});

test('cleanup treats a missing file as safely deletable and retries other file failures later', async () => {
  const missingId = '00000000-0000-4000-8000-000000000001';
  const failedId = '00000000-0000-4000-8000-000000000002';
  const database = new CleanupDatabase([row(missingId, old), row(failedId, old)]);
  const testLogger = logger();

  const result = await cleanupStalePendingBatch({
    database: database as never,
    attachmentStore: {
      delete: async (key: string) => {
        if (key === failedId) {
          const error = new Error('failure') as NodeJS.ErrnoException;
          error.code = 'EACCES';
          throw error;
        }
      }
    } as never,
    staleAgeMs: 1,
    batchSize: 10,
    logger: testLogger,
    now
  });

  assert.deepEqual(result, { lockAcquired: true, selected: 2, deleted: 1, failed: 1 });
  assert.deepEqual(database.rows.map((item) => item.id), [failedId]);
  assert.deepEqual(testLogger.warnings, [{ attachmentId: failedId, errorCode: 'EACCES' }]);
});

test('cleanup skips work when another API instance owns the PostgreSQL cleanup lock', async () => {
  const database = new CleanupDatabase([row('00000000-0000-4000-8000-000000000001', old)]);
  database.locked = false;

  const result = await cleanupStalePendingBatch({
    database: database as never,
    attachmentStore: { delete: async () => { throw new Error('must not run'); } } as never,
    staleAgeMs: 1,
    batchSize: 10,
    logger: logger(),
    now
  });

  assert.deepEqual(result, { lockAcquired: false, selected: 0, deleted: 0, failed: 0 });
  assert.equal(database.rows.length, 1);
});

test('scheduler does not overlap runs and retries after failures', async () => {
  let releaseFirst!: () => void;
  let calls = 0;
  const firstRun = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const testLogger = logger();
  const scheduler = new AttachmentCleanupScheduler({
    intervalMs: 60_000,
    logger: testLogger,
    cleanup: async () => {
      calls += 1;
      if (calls === 1) await firstRun;
      else throw Object.assign(new Error('temporary'), { code: 'ETIMEDOUT' });
    }
  });

  const active = scheduler.runNow();
  assert.equal(await scheduler.runNow(), false);
  releaseFirst();
  assert.equal(await active, true);
  assert.equal(await scheduler.runNow(), true);
  assert.equal(calls, 2);
  assert.deepEqual(testLogger.errors, [{ errorCode: 'ETIMEDOUT' }]);
  await scheduler.stop();
});

test('scheduler runs immediately, recurs while alive, and stops cleanly', async () => {
  let calls = 0;
  let resolveRecurring!: () => void;
  const recurring = new Promise<void>((resolve) => { resolveRecurring = resolve; });
  const scheduler = new AttachmentCleanupScheduler({
    intervalMs: 10,
    logger: logger(),
    cleanup: async () => {
      calls += 1;
      if (calls === 2) resolveRecurring();
    }
  });

  scheduler.start();
  await recurring;
  await scheduler.stop();
  const stoppedAt = calls;
  await new Promise((resolve) => setTimeout(resolve, 25));

  assert.equal(stoppedAt >= 2, true);
  assert.equal(calls, stoppedAt);
});
