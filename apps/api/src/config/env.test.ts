import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ATTACHMENT_DEFAULTS,
  LIVEKIT_AUTHORIZATION_DEFAULTS,
  SESSION_DEFAULTS,
  loadEnv
} from './env.js';

const requiredEnvironment = {
  DATABASE_URL: 'postgresql://cubic:local-test-password@localhost:5432/cubic',
  CORS_ORIGIN: 'http://localhost:3010',
  LIVEKIT_PUBLIC_URL: 'ws://localhost:7880',
  LIVEKIT_API_URL: 'http://localhost:7880',
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

test('browser origin is explicit, canonical, and HTTPS in production', () => {
  assert.throws(
    () => loadEnv({ ...requiredEnvironment, CORS_ORIGIN: undefined }),
    /CORS_ORIGIN:/
  );
  for (const invalid of [
    '*', 'null', 'file:///app', 'https://user@example.test',
    'https://example.test/path', 'https://example.test?query=1',
    'https://example.test#fragment', 'https://one.test,https://two.test'
  ]) {
    assert.throws(() => loadEnv({ ...requiredEnvironment, CORS_ORIGIN: invalid }), /CORS_ORIGIN:/);
  }
  assert.throws(
    () => loadEnv({
      ...requiredEnvironment,
      NODE_ENV: 'production',
      SESSION_COOKIE_SECURE: 'true'
    }),
    /CORS_ORIGIN: must use https when NODE_ENV is production/
  );
  const production = loadEnv({
    ...requiredEnvironment,
    NODE_ENV: 'production',
    SESSION_COOKIE_SECURE: 'true',
    CORS_ORIGIN: 'https://CUBIC.example:443/'
  });
  assert.equal(production.CORS_ORIGIN, 'https://cubic.example');
});

test('LiveKit authorization reconciliation uses a bounded 30 second default', () => {
  const env = loadEnv(requiredEnvironment);
  assert.equal(
    env.LIVEKIT_AUTHORIZATION_RECONCILE_MS,
    LIVEKIT_AUTHORIZATION_DEFAULTS.reconciliationIntervalMs
  );
  for (const invalid of ['0', '4999', '300001', '1e4']) {
    assert.throws(
      () => loadEnv({ ...requiredEnvironment, LIVEKIT_AUTHORIZATION_RECONCILE_MS: invalid }),
      /LIVEKIT_AUTHORIZATION_RECONCILE_MS:/
    );
  }
  assert.throws(
    () => loadEnv({ ...requiredEnvironment, LIVEKIT_API_URL: 'wss://voice.example.test' }),
    /LIVEKIT_API_URL: must use http or https/
  );
});

test('production accepts explicitly enabled secure session cookies', () => {
  const env = loadEnv({
    ...requiredEnvironment,
    NODE_ENV: 'production',
    SESSION_COOKIE_SECURE: 'true',
    CORS_ORIGIN: 'https://cubic.example'
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

test('session idle and socket revalidation defaults are finite and production-safe', () => {
  const env = loadEnv(requiredEnvironment);

  assert.equal(env.SESSION_IDLE_TIMEOUT_MS, SESSION_DEFAULTS.idleTimeoutMs);
  assert.equal(env.SESSION_SOCKET_REVALIDATE_MS, SESSION_DEFAULTS.socketRevalidateMs);
});

test('session timeout settings use strict bounded millisecond integers', () => {
  for (const setting of ['SESSION_IDLE_TIMEOUT_MS', 'SESSION_SOCKET_REVALIDATE_MS'] as const) {
    for (const invalid of ['0', '-1', '1.5', '1e6', ' 300000', 'unlimited']) {
      assert.throws(
        () => loadEnv({ ...requiredEnvironment, [setting]: invalid }),
        new RegExp(`${setting}:`)
      );
    }
  }

  assert.throws(
    () => loadEnv({ ...requiredEnvironment, SESSION_IDLE_TIMEOUT_MS: '299999' }),
    /SESSION_IDLE_TIMEOUT_MS:/
  );
  assert.throws(
    () => loadEnv({ ...requiredEnvironment, SESSION_SOCKET_REVALIDATE_MS: '29999' }),
    /SESSION_SOCKET_REVALIDATE_MS:/
  );
  assert.throws(
    () => loadEnv({ ...requiredEnvironment, SESSION_IDLE_TIMEOUT_MS: '2592000001' }),
    /SESSION_IDLE_TIMEOUT_MS:/
  );
  assert.throws(
    () => loadEnv({ ...requiredEnvironment, SESSION_SOCKET_REVALIDATE_MS: '3600001' }),
    /SESSION_SOCKET_REVALIDATE_MS:/
  );
  assert.throws(
    () => loadEnv({
      ...requiredEnvironment,
      SESSION_IDLE_TIMEOUT_MS: '300000',
      SESSION_SOCKET_REVALIDATE_MS: '300001'
    }),
    /SESSION_SOCKET_REVALIDATE_MS: must not exceed SESSION_IDLE_TIMEOUT_MS/
  );

  const env = loadEnv({
    ...requiredEnvironment,
    SESSION_IDLE_TIMEOUT_MS: '3600000',
    SESSION_SOCKET_REVALIDATE_MS: '60000'
  });
  assert.equal(env.SESSION_IDLE_TIMEOUT_MS, 3_600_000);
  assert.equal(env.SESSION_SOCKET_REVALIDATE_MS, 60_000);
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
