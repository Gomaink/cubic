import assert from 'node:assert/strict';
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { AttachmentStore } from './attachments.js';
import {
  AttachmentReconciler,
  AttachmentReconciliationScheduler
} from './attachment-reconciliation.js';

class ReconciliationDatabase {
  attachments = new Map<string, string>();
  queued = new Set<string>();
  lookupFails = false;

  private query = async (sql: string, params: unknown[] = []) => {
    const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();
    if (['begin', 'commit', 'rollback'].includes(normalized)) {
      return { rows: [], rowCount: 0 };
    }
    if (normalized.includes('pg_try_advisory_lock')) {
      return { rows: [{ acquired: true }], rowCount: 1 };
    }
    if (normalized.includes('pg_advisory_unlock') || normalized.includes('pg_advisory_xact_lock')) {
      return { rows: [{}], rowCount: 1 };
    }
    if (normalized.startsWith('select 1 from attachments where storage_key')) {
      if (this.lookupFails) throw Object.assign(new Error('database unavailable'), { code: '08006' });
      const rows = this.attachments.has(params[0] as string) ? [{}] : [];
      return { rows, rowCount: rows.length };
    }
    if (normalized.startsWith('insert into attachment_file_deletions')) {
      const key = params[0] as string;
      if (this.queued.has(key)) return { rows: [], rowCount: 0 };
      this.queued.add(key);
      return { rows: [{ id: key }], rowCount: 1 };
    }
    if (normalized.startsWith('select id, storage_key from attachments')) {
      const rows = [...this.attachments].map(([storage_key, id]) => ({ id, storage_key }));
      return { rows, rowCount: rows.length };
    }
    throw new Error(`Unexpected reconciliation SQL: ${normalized}`);
  };

  pool = {
    connect: async () => ({ query: this.query, release() {} }),
    query: this.query
  };
}

function logger() {
  return {
    warnings: [] as unknown[],
    info() {},
    error() {},
    warn(bindings: unknown) { this.warnings.push(bindings); }
  };
}

async function fixture(context: test.TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'cubic-reconciliation-test-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const store = new AttachmentStore(root);
  await store.prepare();
  return { root, store };
}

test('old UUID orphan is queued but not directly removed, while recent and unexpected entries are preserved', async (context) => {
  const { store } = await fixture(context);
  const oldKey = '00000000-0000-4000-8000-000000000001';
  const recentKey = '00000000-0000-4000-8000-000000000002';
  const malformed = 'do-not-delete.txt';
  const gracePeriodMs = 24 * 60 * 60 * 1000;
  const now = new Date(Date.now() + gracePeriodMs * 2);
  await writeFile(join(store.root, oldKey), 'old');
  await writeFile(join(store.root, recentKey), 'recent');
  await writeFile(join(store.root, malformed), 'unexpected');
  await utimes(join(store.root, oldKey), new Date(now.getTime() - gracePeriodMs * 2), new Date(now.getTime() - gracePeriodMs * 2));
  await utimes(join(store.root, recentKey), now, now);

  const database = new ReconciliationDatabase();
  const reconciler = new AttachmentReconciler({
    database: database as never,
    attachmentStore: store,
    gracePeriodMs,
    scanBatchSize: 100,
    missingBatchSize: 100,
    logger: logger()
  });
  const result = await reconciler.runBatch(now);

  assert.equal(result.queuedOrphans, 1);
  assert.deepEqual([...database.queued], [oldKey]);
  assert.equal(await readFile(join(store.root, oldKey), 'utf8'), 'old');
  assert.equal(await readFile(join(store.root, recentKey), 'utf8'), 'recent');
  assert.equal(await readFile(join(store.root, malformed), 'utf8'), 'unexpected');
});

test('database uncertainty preserves an old orphan and queues no deletion', async (context) => {
  const { store } = await fixture(context);
  const key = '00000000-0000-4000-8000-000000000003';
  await writeFile(join(store.root, key), 'preserved');
  await utimes(join(store.root, key), new Date(0), new Date(0));
  const database = new ReconciliationDatabase();
  database.lookupFails = true;

  const reconciler = new AttachmentReconciler({
    database: database as never,
    attachmentStore: store,
    gracePeriodMs: 60_000,
    scanBatchSize: 100,
    missingBatchSize: 100,
    logger: logger()
  });
  const result = await reconciler.runBatch(new Date('2030-09-15T12:00:00.000Z'));

  assert.equal(result.databaseUncertain, 1);
  assert.equal(database.queued.size, 0);
  assert.equal(await readFile(join(store.root, key), 'utf8'), 'preserved');
});

test('bounded in-memory sweep advances across intervals instead of repeating the first entry', async (context) => {
  const { store } = await fixture(context);
  const keys = [
    '00000000-0000-4000-8000-000000000011',
    '00000000-0000-4000-8000-000000000012',
    '00000000-0000-4000-8000-000000000013'
  ];
  for (const key of keys) await writeFile(join(store.root, key), key);
  const database = new ReconciliationDatabase();
  const reconciler = new AttachmentReconciler({
    database: database as never,
    attachmentStore: store,
    gracePeriodMs: 60_000,
    scanBatchSize: 1,
    missingBatchSize: 1,
    logger: logger()
  });

  let completed = false;
  for (let run = 0; run < 10 && !completed; run += 1) {
    const result = await reconciler.runBatch(new Date('2030-09-15T12:00:00.000Z'));
    assert.ok(result.inspectedEntries <= 1);
    completed = result.sweepCompleted;
  }

  assert.equal(completed, true);
  assert.deepEqual([...database.queued].sort(), keys);
});

test('symlink entry is never queued, followed, or removed', async (context) => {
  const { root, store } = await fixture(context);
  const outside = join(root, 'outside');
  const key = '00000000-0000-4000-8000-000000000004';
  await writeFile(outside, 'outside');
  await symlink(outside, join(store.root, key));
  const database = new ReconciliationDatabase();
  const reconciler = new AttachmentReconciler({
    database: database as never,
    attachmentStore: store,
    gracePeriodMs: 60_000,
    scanBatchSize: 100,
    missingBatchSize: 100,
    logger: logger()
  });

  await reconciler.runBatch(new Date('2026-09-13T12:00:00.000Z'));
  assert.equal(database.queued.size, 0);
  assert.equal(await readFile(outside, 'utf8'), 'outside');
});

test('a replaced staging directory is rejected instead of followed', async (context) => {
  const { root, store } = await fixture(context);
  const outside = join(root, 'outside-staging');
  await mkdir(outside);
  await writeFile(join(outside, 'sentinel'), 'preserved');
  await rm(store.stagingRoot, { recursive: true, force: true });
  await symlink(outside, store.stagingRoot);

  const database = new ReconciliationDatabase();
  const reconciler = new AttachmentReconciler({
    database: database as never,
    attachmentStore: store,
    gracePeriodMs: 60_000,
    scanBatchSize: 100,
    missingBatchSize: 100,
    logger: logger()
  });

  await assert.rejects(() => reconciler.runBatch(), /Unsafe attachment directory/);
  assert.equal(await readFile(join(outside, 'sentinel'), 'utf8'), 'preserved');
});

test('stale Cubic staging uploads are removed conservatively', async (context) => {
  const { store } = await fixture(context);
  const key = '00000000-0000-4000-8000-000000000006';
  const path = join(store.stagingRoot, `${key}.uploading`);
  await writeFile(path, 'stale');
  await utimes(path, new Date(0), new Date(0));

  const reconciler = new AttachmentReconciler({
    database: new ReconciliationDatabase() as never,
    attachmentStore: store,
    gracePeriodMs: 60_000,
    scanBatchSize: 100,
    missingBatchSize: 100,
    logger: logger()
  });

  const result = await reconciler.runBatch(new Date('2030-09-15T12:00:00.000Z'));
  assert.equal(result.deletedStaging, 1);
  assert.equal((await store.inspectStagingUpload(key)).exists, false);
});

test('recent, malformed, symlink, and final files are preserved or ignored', async (context) => {
  const { root, store } = await fixture(context);
  const recentKey = '00000000-0000-4000-8000-000000000007';
  const malformed = join(store.stagingRoot, 'not-a-cubic-upload.uploading');
  const outside = join(root, 'outside-upload');
  const symlinkKey = '00000000-0000-4000-8000-000000000008';
  const finalKey = '00000000-0000-4000-8000-000000000009';
  const now = new Date();

  const recentPath = join(store.stagingRoot, `${recentKey}.uploading`);
  await writeFile(recentPath, 'recent');
  await utimes(recentPath, now, now);
  await writeFile(malformed, 'unexpected');
  await writeFile(outside, 'outside');
  await symlink(outside, join(store.stagingRoot, `${symlinkKey}.uploading`));
  await writeFile(join(store.root, finalKey), 'final');
  await utimes(join(store.root, finalKey), new Date(0), new Date(0));

  const database = new ReconciliationDatabase();
  database.attachments.set(finalKey, '50000000-0000-4000-8000-000000000009');

  const reconciler = new AttachmentReconciler({
    database: database as never,
    attachmentStore: store,
    gracePeriodMs: 60_000,
    scanBatchSize: 100,
    missingBatchSize: 100,
    logger: logger()
  });

  const result = await reconciler.runBatch(now);
  assert.equal(result.deletedStaging, 0);
  assert.equal((await store.inspectStagingUpload(recentKey)).exists, true);
  assert.equal((await store.inspectStagingUpload(symlinkKey)).exists, true);
  assert.equal(await readFile(malformed, 'utf8'), 'unexpected');
  assert.equal(await readFile(join(store.root, finalKey), 'utf8'), 'final');
  assert.equal(await readFile(outside, 'utf8'), 'outside');
});

test('staging cleanup is bounded and does not remove a recent concurrent upload', async (context) => {
  const { store } = await fixture(context);
  const keys = [
    '00000000-0000-4000-8000-000000000021',
    '00000000-0000-4000-8000-000000000022',
    '00000000-0000-4000-8000-000000000023'
  ];
  for (const key of keys) {
    const path = join(store.stagingRoot, `${key}.uploading`);
    await writeFile(path, key);
    await utimes(path, new Date(0), new Date(0));
  }
  const activeKey = '00000000-0000-4000-8000-000000000024';
  const activePath = join(store.stagingRoot, `${activeKey}.uploading`);
  await writeFile(activePath, 'active');
  const runAt = new Date('2030-09-15T12:00:00.000Z');
  await utimes(activePath, runAt, runAt);

  const reconciler = new AttachmentReconciler({
    database: new ReconciliationDatabase() as never,
    attachmentStore: store,
    gracePeriodMs: 60_000,
    scanBatchSize: 1,
    missingBatchSize: 1,
    logger: logger()
  });

  let completed = false;
  for (let run = 0; run < 20 && !completed; run += 1) {
    const result = await reconciler.runBatch(runAt);
    assert.ok(result.inspectedEntries <= 1);
    completed = result.sweepCompleted;
  }
  assert.equal(completed, true);
  for (const key of keys) assert.equal((await store.inspectStagingUpload(key)).exists, false);
  assert.equal((await store.inspectStagingUpload(activeKey)).exists, true);
});

test('transient staging cleanup failure is logged and retried by the scheduler', async (context) => {
  const { store } = await fixture(context);
  const key = '00000000-0000-4000-8000-000000000025';
  const path = join(store.stagingRoot, `${key}.uploading`);
  await writeFile(path, 'retry');
  await utimes(path, new Date(0), new Date(0));

  const database = new ReconciliationDatabase();
  const testLogger = logger();
  let failures = 0;
  const original = store.discardStagingUpload.bind(store);
  const originalInspect = store.inspectStagingUpload.bind(store);
  store.inspectStagingUpload = async (value: string) =>
    value === key
      ? { exists: true, regular: true, modifiedAtMs: 0 }
      : originalInspect(value);
  store.discardStagingUpload = async (value: string) => {
    if (failures++ === 0) throw Object.assign(new Error('temporary'), { code: 'EACCES' });
    return original(value);
  };
  const reconciler = new AttachmentReconciler({
    database: database as never,
    attachmentStore: store,
    gracePeriodMs: 60_000,
    scanBatchSize: 100,
    missingBatchSize: 100,
    logger: testLogger
  });
  const errors: unknown[] = [];
  const scheduler = new AttachmentReconciliationScheduler({
    intervalMs: 60_000,
    reconciler,
    logger: { error(bindings: unknown) { errors.push(bindings); } }
  });

  await scheduler.runNow();
  await lstat(path);
  await scheduler.runNow();
  await scheduler.stop();
  await assert.rejects(() => lstat(path), { code: 'ENOENT' });
  assert.deepEqual(testLogger.warnings, [{ errorCode: 'EACCES' }]);
  assert.deepEqual(errors, []);
});

test('missing DB-row bytes are reported while metadata remains untouched', async (context) => {
  const { store } = await fixture(context);
  const key = '00000000-0000-4000-8000-000000000005';
  const attachmentId = '50000000-0000-4000-8000-000000000005';
  const database = new ReconciliationDatabase();
  database.attachments.set(key, attachmentId);
  const testLogger = logger();
  const reconciler = new AttachmentReconciler({
    database: database as never,
    attachmentStore: store,
    gracePeriodMs: 60_000,
    scanBatchSize: 100,
    missingBatchSize: 100,
    logger: testLogger
  });

  const result = await reconciler.runBatch();
  assert.equal(result.missingFiles, 1);
  assert.equal(database.attachments.get(key), attachmentId);
  assert.deepEqual(testLogger.warnings, [{ attachmentId, errorCode: 'ENOENT' }]);
});

test('reconciliation scheduler prevents overlap, retries failures, and stops its sweep', async () => {
  let release!: () => void;
  let calls = 0;
  let stops = 0;
  const first = new Promise<void>((resolve) => { release = resolve; });
  const errors: unknown[] = [];
  const reconciler = {
    async runBatch() {
      calls += 1;
      if (calls === 1) await first;
      else throw Object.assign(new Error('temporary'), { code: '08006' });
    },
    async stop() { stops += 1; }
  } as unknown as AttachmentReconciler;
  const scheduler = new AttachmentReconciliationScheduler({
    intervalMs: 60_000,
    reconciler,
    logger: { error(bindings: unknown) { errors.push(bindings); } }
  });

  const active = scheduler.runNow();
  assert.equal(await scheduler.runNow(), false);
  release();
  assert.equal(await active, true);
  assert.equal(await scheduler.runNow(), true);
  await scheduler.stop();
  assert.equal(calls, 2);
  assert.equal(stops, 1);
  assert.deepEqual(errors, [{ errorCode: '08006' }]);
});
