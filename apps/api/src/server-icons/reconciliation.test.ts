import assert from 'node:assert/strict';
import { access, mkdtemp, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { Database } from '@cubic/database';
import { ServerIconReconciler } from './reconciliation.js';
import { ServerIconStore } from './storage.js';

const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
const logger = { info() {}, warn() {} };

function fakeDatabase(isReferenced: (key: string) => boolean): Database {
  return { pool: { query: async (_sql: string, params: string[]) => ({ rowCount: isReferenced(params[0]!) ? 1 : 0 }) } } as unknown as Database;
}

async function oldFile(path: string) {
  await writeFile(path, 'icon');
  await utimes(path, old, old);
}

test('reconciliation removes stale temporary and canonical orphans but preserves referenced and fresh icons', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cubic-icon-reconcile-'));
  const store = new ServerIconStore(root);
  try {
    await store.prepare();
    const orphan = '11111111-1111-4111-8111-111111111111.webp';
    const referenced = '22222222-2222-4222-8222-222222222222.webp';
    const fresh = '33333333-3333-4333-8333-333333333333.webp';
    const staleTemp = '44444444-4444-4444-8444-444444444444.tmp';
    await oldFile(join(store.root, orphan));
    await oldFile(join(store.root, referenced));
    await writeFile(join(store.root, fresh), 'fresh');
    await oldFile(join(store.tempRoot, staleTemp));
    const reconciler = new ServerIconReconciler({ database: fakeDatabase((key) => key === referenced), store, logger, batchSize: 20 });
    const result = await reconciler.runBatch();
    assert.equal(result.deleted, 2);
    assert.equal(result.referenced, 1);
    assert.equal(result.recent, 1);
    await assert.rejects(access(join(store.root, orphan)));
    await assert.rejects(access(join(store.tempRoot, staleTemp)));
    await access(join(store.root, referenced));
    await access(join(store.root, fresh));
    await reconciler.stop();
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('a newly referenced candidate is skipped by the final database lookup', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cubic-icon-reference-'));
  const store = new ServerIconStore(root);
  try {
    await store.prepare();
    const key = '55555555-5555-4555-8555-555555555555.webp';
    await oldFile(join(store.root, key));
    let checked = 0;
    const reconciler = new ServerIconReconciler({ database: fakeDatabase(() => { checked++; return true; }), store, logger });
    const result = await reconciler.runBatch();
    assert.equal(checked, 1);
    assert.equal(result.referenced, 1);
    await access(join(store.root, key));
    await reconciler.stop();
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('unexpected names and symlinks cannot escape icon namespace; each pass is bounded', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cubic-icon-bounds-'));
  const store = new ServerIconStore(root);
  try {
    await store.prepare();
    const outside = join(root, 'outside');
    await oldFile(outside);
    await symlink(outside, join(store.root, '66666666-6666-4666-8666-666666666666.webp'));
    await oldFile(join(store.root, 'unexpected.txt'));
    await oldFile(join(store.root, '77777777-7777-4777-8777-777777777777.webp'));
    const reconciler = new ServerIconReconciler({ database: fakeDatabase(() => false), store, logger, batchSize: 1 });
    const first = await reconciler.runBatch();
    assert.equal(first.inspected, 1);
    for (let i = 0; i < 8; i++) await reconciler.runBatch();
    await access(outside);
    await access(join(store.root, 'unexpected.txt'));
    await assert.rejects(access(join(store.root, '77777777-7777-4777-8777-777777777777.webp')));
    await reconciler.stop();
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('failed unlink remains an orphan and is retried on a later sweep', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cubic-icon-retry-'));
  const store = new ServerIconStore(root);
  try {
    await store.prepare();
    const key = '88888888-8888-4888-8888-888888888888.webp';
    await oldFile(join(store.root, key));
    const original = store.deleteCanonical.bind(store);
    let failures = 1;
    store.deleteCanonical = async (value) => { if (failures-- > 0) throw new Error('simulated unlink failure'); await original(value); };
    const reconciler = new ServerIconReconciler({ database: fakeDatabase(() => false), store, logger, batchSize: 10 });
    assert.equal((await reconciler.runBatch()).deleted, 0);
    await access(join(store.root, key));
    assert.equal((await reconciler.runBatch()).deleted, 1);
    await assert.rejects(access(join(store.root, key)));
    await reconciler.stop();
  } finally { await rm(root, { recursive: true, force: true }); }
});
