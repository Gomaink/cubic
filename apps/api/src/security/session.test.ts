import assert from 'node:assert/strict';
import test from 'node:test';
import { digestSessionToken } from './session.js';

test('session token digests are stable and do not expose the token', () => {
  const token = 'example-session-token';
  const digest = digestSessionToken(token);

  assert.equal(digest, digestSessionToken(token));
  assert.notEqual(digest, token);
  assert.match(digest, /^[a-f0-9]{64}$/);
});
