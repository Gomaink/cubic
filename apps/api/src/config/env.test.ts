import assert from 'node:assert/strict';
import test from 'node:test';
import { loadEnv } from './env.js';

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
