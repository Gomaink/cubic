import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AttachmentDeletionScheduler,
  deletionBackoffMs,
  sanitizeDeletionErrorCode
} from './attachment-deletions.js';

test('deletion backoff is exponential and capped', () => {
  assert.equal(deletionBackoffMs(0, 1_000, 60_000), 1_000);
  assert.equal(deletionBackoffMs(3, 1_000, 60_000), 8_000);
  assert.equal(deletionBackoffMs(30, 1_000, 60_000), 60_000);
});

test('deletion error codes are bounded and sanitized without exception text', () => {
  assert.equal(sanitizeDeletionErrorCode({ code: 'EACCES/path secret' }), 'EACCES_path_secret');
  assert.equal(sanitizeDeletionErrorCode(new Error('/private/path')), 'UNKNOWN');
  assert.equal(sanitizeDeletionErrorCode({ code: 'x'.repeat(100) }).length, 64);
});

test('deletion scheduler prevents overlap, contains failures, and retries later', async () => {
  let release!: () => void;
  let calls = 0;
  const first = new Promise<void>((resolve) => { release = resolve; });
  const errors: unknown[] = [];
  const scheduler = new AttachmentDeletionScheduler({
    intervalMs: 60_000,
    logger: { error(bindings: unknown) { errors.push(bindings); } },
    run: async () => {
      calls += 1;
      if (calls === 1) await first;
      else throw Object.assign(new Error('temporary'), { code: '08006' });
    }
  });

  const active = scheduler.runNow();
  assert.equal(await scheduler.runNow(), false);
  release();
  assert.equal(await active, true);
  assert.equal(await scheduler.runNow(), true);
  assert.equal(calls, 2);
  assert.deepEqual(errors, [{ errorCode: '08006' }]);
  await scheduler.stop();
});
