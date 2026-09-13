import assert from 'node:assert/strict';
import test from 'node:test';
import { ATTACHMENT_DEFAULTS, loadEnv } from './env.js';

const requiredEnvironment = {
  DATABASE_URL: 'postgresql://cubic:local-test-password@localhost:5432/cubic',
  LIVEKIT_PUBLIC_URL: 'ws://localhost:7880',
  LIVEKIT_API_KEY: 'local-test-key',
  LIVEKIT_API_SECRET: 'local-test-secret-with-at-least-32-characters',
  TRUST_PROXY_CIDRS: '127.0.0.1/32,::1/128'
};

test('production requires secure session cookies', () => {
  assert.throws(
    () => loadEnv({ ...requiredEnvironment, NODE_ENV: 'production' }),
    /SESSION_COOKIE_SECURE: must be true when NODE_ENV is production/
  );
  assert.throws(
    () => loadEnv({ ...requiredEnvironment, NODE_ENV: 'production', SESSION_COOKIE_SECURE: 'false' }),
    /SESSION_COOKIE_SECURE: must be true when NODE_ENV is production/
  );
});

test('production accepts explicitly enabled secure session cookies', () => {
  const env = loadEnv({
    ...requiredEnvironment,
    NODE_ENV: 'production',
    SESSION_COOKIE_SECURE: 'true'
  });

  assert.equal(env.SESSION_COOKIE_SECURE, true);
});

test('development retains an explicit plain HTTP workflow', () => {
  const env = loadEnv({
    ...requiredEnvironment,
    NODE_ENV: 'development',
    SESSION_COOKIE_SECURE: 'false'
  });

  assert.equal(env.SESSION_COOKIE_SECURE, false);
});

test('trusted proxy CIDRs are required and strictly parsed', () => {
  assert.throws(
    () => loadEnv({ ...requiredEnvironment, TRUST_PROXY_CIDRS: undefined }),
    /TRUST_PROXY_CIDRS: Invalid input/
  );
  assert.throws(
    () => loadEnv({ ...requiredEnvironment, TRUST_PROXY_CIDRS: '10.0.0.0/8,not-a-cidr' }),
    /TRUST_PROXY_CIDRS: contains invalid CIDR "not-a-cidr"/
  );
  assert.throws(
    () => loadEnv({ ...requiredEnvironment, TRUST_PROXY_CIDRS: '10.0.0.0/33' }),
    /TRUST_PROXY_CIDRS: contains invalid CIDR "10.0.0.0\/33"/
  );
  assert.throws(
    () => loadEnv({ ...requiredEnvironment, TRUST_PROXY_CIDRS: '0.0.0.0/0' }),
    /TRUST_PROXY_CIDRS: contains invalid CIDR "0.0.0.0\/0"/
  );
  const env = loadEnv({
    ...requiredEnvironment,
    TRUST_PROXY_CIDRS: '172.30.0.0/16, 2001:db8::/64,172.30.0.0/16'
  });
  assert.deepEqual(env.TRUST_PROXY_CIDRS, ['172.30.0.0/16', '2001:db8::/64']);
});

test('numeric proxy-hop configuration is rejected without a compatibility fallback', () => {
  assert.throws(
    () => loadEnv({ ...requiredEnvironment, TRUST_PROXY_HOPS: '1' }),
    /TRUST_PROXY_HOPS has been removed; use TRUST_PROXY_CIDRS/
  );
});

test('attachment quota, storage, rate, and cleanup defaults are finite and documented in base units', () => {
  const env = loadEnv(requiredEnvironment);

  assert.equal(env.ATTACHMENT_PENDING_MAX_COUNT, ATTACHMENT_DEFAULTS.pendingMaxCount);
  assert.equal(env.ATTACHMENT_PENDING_MAX_BYTES, ATTACHMENT_DEFAULTS.pendingMaxBytes);
  assert.equal(env.ATTACHMENT_MIN_FREE_BYTES, ATTACHMENT_DEFAULTS.minFreeBytes);
  assert.equal(env.ATTACHMENT_UPLOAD_RATE_LIMIT_MAX, ATTACHMENT_DEFAULTS.uploadRateLimitMax);
  assert.equal(
    env.ATTACHMENT_UPLOAD_RATE_LIMIT_WINDOW_MS,
    ATTACHMENT_DEFAULTS.uploadRateLimitWindowMs
  );
  assert.equal(env.ATTACHMENT_CLEANUP_INTERVAL_MS, ATTACHMENT_DEFAULTS.cleanupIntervalMs);
  assert.equal(env.ATTACHMENT_STALE_AGE_MS, ATTACHMENT_DEFAULTS.staleAgeMs);
  assert.equal(env.ATTACHMENT_CLEANUP_BATCH_SIZE, ATTACHMENT_DEFAULTS.cleanupBatchSize);
  assert.equal(env.ATTACHMENT_DELETION_INTERVAL_MS, ATTACHMENT_DEFAULTS.deletionIntervalMs);
  assert.equal(env.ATTACHMENT_DELETION_BATCH_SIZE, ATTACHMENT_DEFAULTS.deletionBatchSize);
  assert.equal(env.ATTACHMENT_DELETION_LEASE_MS, ATTACHMENT_DEFAULTS.deletionLeaseMs);
  assert.equal(env.ATTACHMENT_DELETION_RETRY_BASE_MS, ATTACHMENT_DEFAULTS.deletionRetryBaseMs);
  assert.equal(env.ATTACHMENT_DELETION_RETRY_MAX_MS, ATTACHMENT_DEFAULTS.deletionRetryMaxMs);
  assert.equal(env.ATTACHMENT_RECONCILIATION_INTERVAL_MS, ATTACHMENT_DEFAULTS.reconciliationIntervalMs);
  assert.equal(env.ATTACHMENT_ORPHAN_GRACE_MS, ATTACHMENT_DEFAULTS.orphanGraceMs);
  assert.equal(env.ATTACHMENT_RECONCILIATION_SCAN_BATCH_SIZE, ATTACHMENT_DEFAULTS.reconciliationScanBatchSize);
  assert.equal(env.ATTACHMENT_RECONCILIATION_MISSING_BATCH_SIZE, ATTACHMENT_DEFAULTS.reconciliationMissingBatchSize);
});

test('attachment quota and cleanup configuration is strictly parsed', () => {
  const settings = [
    'ATTACHMENT_PENDING_MAX_COUNT',
    'ATTACHMENT_PENDING_MAX_BYTES',
    'ATTACHMENT_MIN_FREE_BYTES',
    'ATTACHMENT_UPLOAD_RATE_LIMIT_MAX',
    'ATTACHMENT_UPLOAD_RATE_LIMIT_WINDOW_MS',
    'ATTACHMENT_CLEANUP_INTERVAL_MS',
    'ATTACHMENT_STALE_AGE_MS',
    'ATTACHMENT_CLEANUP_BATCH_SIZE',
    'ATTACHMENT_DELETION_INTERVAL_MS',
    'ATTACHMENT_DELETION_BATCH_SIZE',
    'ATTACHMENT_DELETION_LEASE_MS',
    'ATTACHMENT_DELETION_RETRY_BASE_MS',
    'ATTACHMENT_DELETION_RETRY_MAX_MS',
    'ATTACHMENT_RECONCILIATION_INTERVAL_MS',
    'ATTACHMENT_ORPHAN_GRACE_MS',
    'ATTACHMENT_RECONCILIATION_SCAN_BATCH_SIZE',
    'ATTACHMENT_RECONCILIATION_MISSING_BATCH_SIZE'
  ] as const;

  for (const setting of settings) {
    for (const invalid of ['0', '-1', '1.5', '1e6', ' 20', 'twenty']) {
      assert.throws(
        () => loadEnv({ ...requiredEnvironment, [setting]: invalid }),
        new RegExp(`${setting}:`)
      );
    }
  }

  assert.throws(
    () => loadEnv({
      ...requiredEnvironment,
      ATTACHMENT_MAX_BYTES: String(25 * 1024 * 1024),
      ATTACHMENT_PENDING_MAX_BYTES: String(20 * 1024 * 1024)
    }),
    /ATTACHMENT_PENDING_MAX_BYTES: must be at least ATTACHMENT_MAX_BYTES/
  );

  assert.throws(
    () => loadEnv({
      ...requiredEnvironment,
      ATTACHMENT_DELETION_RETRY_BASE_MS: '60000',
      ATTACHMENT_DELETION_RETRY_MAX_MS: '5000'
    }),
    /ATTACHMENT_DELETION_RETRY_MAX_MS: must be at least ATTACHMENT_DELETION_RETRY_BASE_MS/
  );
});
