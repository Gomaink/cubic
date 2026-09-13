import assert from 'node:assert/strict';
import test from 'node:test';
import { loadEnv } from './env.js';

const requiredEnvironment = {
  DATABASE_URL: 'postgresql://cubic:local-test-password@localhost:5432/cubic',
  LIVEKIT_PUBLIC_URL: 'ws://localhost:7880',
  LIVEKIT_API_KEY: 'local-test-key',
  LIVEKIT_API_SECRET: 'local-test-secret-with-at-least-32-characters'
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
