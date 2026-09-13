import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PendingAttachmentQuotaError,
  insertPendingAttachmentWithinQuota,
  type PendingAttachmentInsert
} from './attachment-quotas.js';

type QuotaRow = {
  uploader_id: string;
  message_id: string | null;
  size_bytes: number;
  storage_key: string;
};

class QuotaDatabase {
  rows: QuotaRow[] = [];
  calls: string[] = [];

  pool = {
    connect: async () => {
      let snapshot: QuotaRow[] = [];
      return {
        query: async (sql: string, params: any[] = []) => {
          const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();
          this.calls.push(normalized);
          if (normalized === 'begin') {
            snapshot = this.rows.map((row) => ({ ...row }));
            return { rows: [], rowCount: 0 };
          }
          if (normalized === 'commit') return { rows: [], rowCount: 0 };
          if (normalized === 'rollback') {
            this.rows = snapshot;
            return { rows: [], rowCount: 0 };
          }
          if (normalized.includes('pg_advisory_xact_lock')) {
            return { rows: [{}], rowCount: 1 };
          }
          if (normalized.startsWith('select count(*)::integer')) {
            const pending = this.rows.filter(
              (row) => row.uploader_id === params[0] && row.message_id === null
            );
            return {
              rows: [{
                pending_count: pending.length,
                pending_bytes: String(pending.reduce((sum, row) => sum + row.size_bytes, 0))
              }],
              rowCount: 1
            };
          }
          if (normalized.startsWith('insert into attachments')) {
            const row = {
              uploader_id: params[1],
              message_id: null,
              storage_key: params[2],
              size_bytes: params[6]
            };
            this.rows.push(row);
            return { rows: [row], rowCount: 1 };
          }
          throw new Error(`Unexpected quota SQL: ${normalized}`);
        },
        release() {}
      };
    }
  };
}

const userA = '10000000-0000-4000-8000-000000000001';
const userB = '10000000-0000-4000-8000-000000000002';

function pending(
  uploaderId: string,
  key: string,
  sizeBytes = 10
): PendingAttachmentInsert {
  return {
    conversationId: '20000000-0000-4000-8000-000000000001',
    uploaderId,
    key,
    originalName: 'file.bin',
    contentType: 'application/octet-stream',
    kind: 'file',
    sizeBytes,
    width: null,
    height: null
  };
}

test('pending count quota rejects only the over-limit insert and leaves no row', async () => {
  const database = new QuotaDatabase();
  await insertPendingAttachmentWithinQuota(
    database as never,
    pending(userA, '00000000-0000-4000-8000-000000000001'),
    { maxCount: 1, maxBytes: 100 }
  );

  await assert.rejects(
    () => insertPendingAttachmentWithinQuota(
      database as never,
      pending(userA, '00000000-0000-4000-8000-000000000002'),
      { maxCount: 1, maxBytes: 100 }
    ),
    (error: unknown) => error instanceof PendingAttachmentQuotaError && error.reason === 'count'
  );
  assert.equal(database.rows.length, 1);
});

test('publication runs after metadata insert and before commit, and publication failure rolls back metadata', async () => {
  const database = new QuotaDatabase();
  await insertPendingAttachmentWithinQuota(
    database as never,
    pending(userA, '00000000-0000-4000-8000-000000000010'),
    { maxCount: 2, maxBytes: 100 },
    async () => { database.calls.push('publish'); }
  );
  assert.ok(database.calls.findIndex((call) => call.startsWith('insert into attachments')) < database.calls.indexOf('publish'));
  assert.ok(database.calls.indexOf('publish') < database.calls.indexOf('commit'));

  const failing = new QuotaDatabase();
  await assert.rejects(
    () => insertPendingAttachmentWithinQuota(
      failing as never,
      pending(userA, '00000000-0000-4000-8000-000000000011'),
      { maxCount: 2, maxBytes: 100 },
      async () => { throw new Error('rename failed'); }
    ),
    /rename failed/
  );
  assert.equal(failing.rows.length, 0);
  assert.ok(failing.calls.includes('rollback'));
});

test('pending byte quota is uploader-scoped and excludes bound attachments', async () => {
  const database = new QuotaDatabase();
  database.rows.push(
    { uploader_id: userA, message_id: null, size_bytes: 8, storage_key: 'a-pending' },
    { uploader_id: userA, message_id: 'bound', size_bytes: 99, storage_key: 'a-bound' },
    { uploader_id: userB, message_id: null, size_bytes: 99, storage_key: 'b-pending' }
  );

  await insertPendingAttachmentWithinQuota(
    database as never,
    pending(userA, '00000000-0000-4000-8000-000000000001', 2),
    { maxCount: 10, maxBytes: 10 }
  );
  await assert.rejects(
    () => insertPendingAttachmentWithinQuota(
      database as never,
      pending(userA, '00000000-0000-4000-8000-000000000002', 1),
      { maxCount: 10, maxBytes: 10 }
    ),
    (error: unknown) => error instanceof PendingAttachmentQuotaError && error.reason === 'bytes'
  );

  assert.equal(database.rows.filter((row) => row.uploader_id === userA).length, 3);
});
