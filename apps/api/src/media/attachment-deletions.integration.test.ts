import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import test from 'node:test';
import { Pool } from 'pg';
import type { Database } from '@cubic/database';
import { AttachmentStore } from './attachments.js';
import { cleanupStalePendingBatch } from './attachment-cleanup.js';
import {
  acknowledgeAttachmentDeletion,
  claimAttachmentDeletionJobs,
  retryAttachmentDeletion,
  runAttachmentDeletionBatch
} from './attachment-deletions.js';

const connectionString = process.env.CUBIC_ATTACHMENT_TEST_DATABASE_URL;
const migrationPath = fileURLToPath(new URL(
  '../../../../packages/database/drizzle/0007_purple_exodus.sql',
  import.meta.url
));

async function setupDatabase(context: test.TestContext) {
  if (!connectionString) throw new Error('Test database URL is unavailable.');
  const schema = `attachment_deletion_test_${randomUUID().replaceAll('-', '')}`;
  const administrator = new Pool({ connectionString, max: 1 });
  await administrator.query(`create schema "${schema}"`);
  const pool = new Pool({
    connectionString,
    max: 8,
    options: `-c search_path=${schema}`
  });
  context.after(async () => {
    await pool.end();
    await administrator.query(`drop schema "${schema}" cascade`);
    await administrator.end();
  });

  await pool.query(`
    create table users (id uuid primary key);
    create table conversations (
      id uuid primary key,
      kind varchar(16) not null default 'direct'
    );
    create table messages (
      id uuid primary key,
      conversation_id uuid not null references conversations(id) on delete cascade,
      deleted_at timestamptz
    );
    create table attachments (
      id uuid primary key,
      conversation_id uuid not null references conversations(id) on delete cascade,
      uploader_id uuid not null references users(id) on delete cascade,
      message_id uuid references messages(id) on delete cascade,
      storage_key text not null unique,
      created_at timestamptz not null default now()
    );
  `);
  const migration = (await readFile(migrationPath, 'utf8'))
    .replaceAll('--> statement-breakpoint', '');
  await pool.query(migration);
  return { database: { pool } as Database, pool };
}

async function insertGraph(pool: Pool, options: {
  key?: string;
  attachmentId?: string;
  userId?: string;
  conversationId?: string;
  messageId?: string;
  kind?: 'direct' | 'group';
} = {}) {
  const userId = options.userId ?? randomUUID();
  const conversationId = options.conversationId ?? randomUUID();
  const messageId = options.messageId ?? randomUUID();
  const attachmentId = options.attachmentId ?? randomUUID();
  const key = options.key ?? randomUUID();
  await pool.query('insert into users (id) values ($1) on conflict do nothing', [userId]);
  await pool.query(
    'insert into conversations (id, kind) values ($1, $2) on conflict do nothing',
    [conversationId, options.kind ?? 'direct']
  );
  await pool.query(
    'insert into messages (id, conversation_id) values ($1, $2) on conflict do nothing',
    [messageId, conversationId]
  );
  await pool.query(
    `insert into attachments (id, conversation_id, uploader_id, message_id, storage_key)
     values ($1, $2, $3, $4, $5)`,
    [attachmentId, conversationId, userId, messageId, key]
  );
  return { userId, conversationId, messageId, attachmentId, key };
}

function logger() {
  return { info() {}, warn() {}, error() {} };
}

test('attachment delete trigger is durable, idempotent, cascade-aware, and transactional', { skip: !connectionString }, async (context) => {
  if (!connectionString) return;
  const { pool } = await setupDatabase(context);

  const direct = await insertGraph(pool);
  await pool.query('delete from attachments where id = $1', [direct.attachmentId]);
  const directJob = await pool.query(
    'select attachment_id, storage_key, reason, state from attachment_file_deletions where storage_key = $1',
    [direct.key]
  );
  assert.deepEqual(directJob.rows, [{
    attachment_id: direct.attachmentId,
    storage_key: direct.key,
    reason: 'metadata_deleted',
    state: 'pending'
  }]);

  const duplicate = await insertGraph(pool);
  await pool.query(
    `insert into attachment_file_deletions (attachment_id, storage_key, reason)
     values ($1, $2, 'metadata_deleted')`,
    [duplicate.attachmentId, duplicate.key]
  );
  await pool.query('delete from attachments where id = $1', [duplicate.attachmentId]);
  const duplicateCount = await pool.query(
    'select count(*)::integer as count from attachment_file_deletions where storage_key = $1',
    [duplicate.key]
  );
  assert.equal(duplicateCount.rows[0].count, 1);

  const rolledBack = await insertGraph(pool);
  const rollbackClient = await pool.connect();
  await rollbackClient.query('begin');
  await rollbackClient.query('delete from attachments where id = $1', [rolledBack.attachmentId]);
  await rollbackClient.query('rollback');
  rollbackClient.release();
  assert.equal((await pool.query('select 1 from attachments where id = $1', [rolledBack.attachmentId])).rowCount, 1);
  assert.equal((await pool.query('select 1 from attachment_file_deletions where storage_key = $1', [rolledBack.key])).rowCount, 0);

  for (const cascade of ['conversation', 'group', 'user'] as const) {
    const graph = await insertGraph(pool, { kind: cascade === 'group' ? 'group' : 'direct' });
    if (cascade === 'user') {
      await pool.query('delete from users where id = $1', [graph.userId]);
    } else {
      await pool.query('delete from conversations where id = $1', [graph.conversationId]);
    }
    assert.equal((await pool.query(
      'select 1 from attachment_file_deletions where storage_key = $1',
      [graph.key]
    )).rowCount, 1);
  }
});

test('pending attachment DELETE and binding serialize without destroying a winner', { skip: !connectionString }, async (context) => {
  if (!connectionString) return;
  const { pool } = await setupDatabase(context);

  const bindWins = await insertGraph(pool);
  await pool.query('update attachments set message_id = null where id = $1', [bindWins.attachmentId]);
  const binding = await pool.connect();
  const deleting = await pool.connect();
  await binding.query('begin');
  await binding.query('update attachments set message_id = $1 where id = $2 and message_id is null', [bindWins.messageId, bindWins.attachmentId]);
  const losingDelete = deleting.query(
    'delete from attachments where id = $1 and uploader_id = $2 and message_id is null returning id',
    [bindWins.attachmentId, bindWins.userId]
  );
  await new Promise((resolve) => setTimeout(resolve, 25));
  await binding.query('commit');
  assert.equal((await losingDelete).rowCount, 0);
  binding.release();
  deleting.release();
  assert.equal((await pool.query('select message_id from attachments where id = $1', [bindWins.attachmentId])).rows[0].message_id, bindWins.messageId);
  assert.equal((await pool.query('select 1 from attachment_file_deletions where storage_key = $1', [bindWins.key])).rowCount, 0);

  const deleteWins = await insertGraph(pool);
  await pool.query('update attachments set message_id = null where id = $1', [deleteWins.attachmentId]);
  const firstDelete = await pool.connect();
  const secondBind = await pool.connect();
  await firstDelete.query('begin');
  await firstDelete.query(
    'delete from attachments where id = $1 and uploader_id = $2 and message_id is null',
    [deleteWins.attachmentId, deleteWins.userId]
  );
  const losingBind = secondBind.query(
    'update attachments set message_id = $1 where id = $2 and message_id is null',
    [deleteWins.messageId, deleteWins.attachmentId]
  );
  await new Promise((resolve) => setTimeout(resolve, 25));
  await firstDelete.query('commit');
  assert.equal((await losingBind).rowCount, 0);
  firstDelete.release();
  secondBind.release();
  assert.equal((await pool.query('select 1 from attachment_file_deletions where storage_key = $1', [deleteWins.key])).rowCount, 1);
});

test('stale pending cleanup deletes metadata only and durably queues the file', { skip: !connectionString }, async (context) => {
  if (!connectionString) return;
  const { database, pool } = await setupDatabase(context);
  const graph = await insertGraph(pool);
  await pool.query(
    `update attachments
        set message_id = null,
            created_at = $2
      where id = $1`,
    [graph.attachmentId, new Date('2026-09-10T12:00:00.000Z')]
  );

  const result = await cleanupStalePendingBatch({
    database,
    staleAgeMs: 24 * 60 * 60 * 1000,
    batchSize: 10,
    logger: logger(),
    now: new Date('2026-09-13T12:00:00.000Z')
  });

  assert.equal(result.deleted, 1);
  assert.equal((await pool.query('select 1 from attachments where id = $1', [graph.attachmentId])).rowCount, 0);
  assert.equal((await pool.query(
    'select 1 from attachment_file_deletions where storage_key = $1',
    [graph.key]
  )).rowCount, 1);
});

test('deletion worker handles success, ENOENT, retry backoff, lease expiry, and stale workers', { skip: !connectionString }, async (context) => {
  if (!connectionString) return;
  const { database, pool } = await setupDatabase(context);
  const root = await mkdtemp(join(tmpdir(), 'cubic-deletion-worker-test-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const store = new AttachmentStore(root);
  await store.prepare();

  const stored = await store.save(Readable.from(['delete me']), {
    originalName: 'delete.bin',
    claimedMime: 'application/octet-stream',
    maxBytes: 1024
  });
  await store.publish(stored.key);
  const missingKey = randomUUID();
  await pool.query(
    `insert into attachment_file_deletions (storage_key, reason)
     values ($1, 'orphan'), ($2, 'orphan')`,
    [stored.key, missingKey]
  );
  const success = await runAttachmentDeletionBatch({
    database,
    attachmentStore: store,
    batchSize: 10,
    leaseMs: 60_000,
    baseBackoffMs: 1_000,
    maximumBackoffMs: 60_000,
    logger: logger()
  });
  assert.equal(success.deleted, 2);
  assert.equal((await store.inspect(stored.key)).exists, false);
  assert.equal((await pool.query('select 1 from attachment_file_deletions')).rowCount, 0);

  const failedKey = randomUUID();
  await pool.query(
    `insert into attachment_file_deletions (storage_key, reason)
     values ($1, 'orphan')`,
    [failedKey]
  );
  const failed = await runAttachmentDeletionBatch({
    database,
    attachmentStore: { delete: async () => {
      throw Object.assign(new Error('path must not be stored'), { code: 'EACCES' });
    } } as unknown as AttachmentStore,
    batchSize: 10,
    leaseMs: 60_000,
    baseBackoffMs: 1_000,
    maximumBackoffMs: 60_000,
    logger: logger(),
    now: new Date('2030-09-13T12:00:00.000Z')
  });
  assert.equal(failed.retried, 1);
  const retry = await pool.query(
    `select state, attempt_count, last_error_code, next_attempt_at
       from attachment_file_deletions where storage_key = $1`,
    [failedKey]
  );
  assert.equal(retry.rows[0].state, 'pending');
  assert.equal(retry.rows[0].attempt_count, 1);
  assert.equal(retry.rows[0].last_error_code, 'EACCES');
  assert.equal(new Date(retry.rows[0].next_attempt_at).toISOString(), '2030-09-13T12:00:01.000Z');

  await pool.query('delete from attachment_file_deletions');
  const leaseKey = randomUUID();
  await pool.query(
    `insert into attachment_file_deletions (storage_key, reason)
     values ($1, 'orphan')`,
    [leaseKey]
  );
  const firstToken = randomUUID();
  const secondToken = randomUUID();
  const first = (await claimAttachmentDeletionJobs({
    database,
    batchSize: 1,
    leaseMs: 1_000,
    now: new Date('2030-09-13T12:00:00.000Z'),
    leaseToken: firstToken
  }))[0]!;
  const reclaimed = (await claimAttachmentDeletionJobs({
    database,
    batchSize: 1,
    leaseMs: 1_000,
    now: new Date('2030-09-13T12:00:02.000Z'),
    leaseToken: secondToken
  }))[0]!;
  assert.equal(reclaimed.id, first.id);
  assert.equal(await acknowledgeAttachmentDeletion(database, first), false);
  assert.equal(await retryAttachmentDeletion({
    database,
    job: first,
    error: Object.assign(new Error('stale'), { code: 'EIO' }),
    baseBackoffMs: 1_000,
    maximumBackoffMs: 60_000
  }), false);
  assert.equal(await acknowledgeAttachmentDeletion(database, reclaimed), true);
});

test('outbox rejects malformed storage keys', { skip: !connectionString }, async (context) => {
  if (!connectionString) return;
  const { pool } = await setupDatabase(context);
  await assert.rejects(
    () => pool.query(
      `insert into attachment_file_deletions (storage_key, reason)
       values ('../escape', 'orphan')`
    ),
    (error: unknown) => (error as { code?: string }).code === '23514'
  );
});
