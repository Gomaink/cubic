import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Pool } from 'pg';
import type { Database } from '@cubic/database';
import {
  PendingAttachmentQuotaError,
  insertPendingAttachmentWithinQuota,
  type PendingAttachmentInsert
} from './attachment-quotas.js';

const connectionString = process.env.CUBIC_ATTACHMENT_TEST_DATABASE_URL;

function attachment(uploaderId: string, key: string, sizeBytes: number): PendingAttachmentInsert {
  return {
    conversationId: randomUUID(),
    uploaderId,
    key,
    originalName: 'concurrency.bin',
    contentType: 'application/octet-stream',
    kind: 'file',
    sizeBytes,
    width: null,
    height: null
  };
}

test(
  'PostgreSQL advisory lock prevents concurrent same-user quota overshoot',
  { skip: !connectionString },
  async () => {
    if (!connectionString) return;

    const schemaName = `attachment_quota_test_${randomUUID().replaceAll('-', '')}`;
    const administrator = new Pool({ connectionString, max: 1 });
    await administrator.query(`create schema "${schemaName}"`);

    const pool = new Pool({
      connectionString,
      max: 4,
      options: `-c search_path=${schemaName}`
    });

    try {
      await pool.query(
        `create table attachments (
           id uuid primary key default gen_random_uuid(),
           conversation_id uuid not null,
           uploader_id uuid not null,
           message_id uuid,
           storage_key text not null unique,
           original_name text not null,
           content_type varchar(160) not null,
           kind varchar(16) not null,
           size_bytes integer not null,
           width integer,
           height integer,
           created_at timestamptz not null default now(),
           attached_at timestamptz
         )`
      );

      const database = { pool } as Database;
      const uploaderA = randomUUID();
      const uploaderB = randomUUID();
      const attempts = await Promise.allSettled([
        insertPendingAttachmentWithinQuota(
          database,
          attachment(uploaderA, randomUUID(), 6),
          { maxCount: 1, maxBytes: 10 }
        ),
        insertPendingAttachmentWithinQuota(
          database,
          attachment(uploaderA, randomUUID(), 6),
          { maxCount: 1, maxBytes: 10 }
        )
      ]);

      assert.equal(attempts.filter((result) => result.status === 'fulfilled').length, 1);
      const rejected = attempts.find((result) => result.status === 'rejected');
      assert.ok(rejected?.status === 'rejected');
      assert.ok(rejected.reason instanceof PendingAttachmentQuotaError);
      assert.equal(rejected.reason.reason, 'count');

      const count = await pool.query(
        'select count(*)::integer as count from attachments where uploader_id = $1 and message_id is null',
        [uploaderA]
      );
      assert.equal(count.rows[0].count, 1);

      const byteUploader = randomUUID();
      const byteAttempts = await Promise.allSettled([
        insertPendingAttachmentWithinQuota(
          database,
          attachment(byteUploader, randomUUID(), 6),
          { maxCount: 10, maxBytes: 10 }
        ),
        insertPendingAttachmentWithinQuota(
          database,
          attachment(byteUploader, randomUUID(), 6),
          { maxCount: 10, maxBytes: 10 }
        )
      ]);
      assert.equal(byteAttempts.filter((result) => result.status === 'fulfilled').length, 1);
      const byteRejected = byteAttempts.find((result) => result.status === 'rejected');
      assert.ok(byteRejected?.status === 'rejected');
      assert.ok(byteRejected.reason instanceof PendingAttachmentQuotaError);
      assert.equal(byteRejected.reason.reason, 'bytes');

      await pool.query(
        'update attachments set message_id = $1 where uploader_id = $2',
        [randomUUID(), uploaderA]
      );
      await insertPendingAttachmentWithinQuota(
        database,
        attachment(uploaderA, randomUUID(), 10),
        { maxCount: 1, maxBytes: 10 }
      );
      await insertPendingAttachmentWithinQuota(
        database,
        attachment(uploaderB, randomUUID(), 10),
        { maxCount: 1, maxBytes: 10 }
      );

      const perUser = await pool.query(
        `select uploader_id, count(*)::integer as count
          from attachments
          where message_id is null
          group by uploader_id
          order by uploader_id`
      );
      assert.deepEqual(
        perUser.rows.map((row) => row.count).sort(),
        [1, 1, 1]
      );
    } finally {
      await pool.end();
      await administrator.query(`drop schema "${schemaName}" cascade`);
      await administrator.end();
    }
  }
);
