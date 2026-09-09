import assert from 'node:assert/strict';
import test from 'node:test';
import bcrypt from 'bcryptjs';
import { hashPassword, verifyPassword } from './password.js';

test('new passwords use Argon2id', async () => {
  const hash = await hashPassword('correct-horse-battery-staple');
  assert.match(hash, /^\$argon2id\$/);

  const valid = await verifyPassword(hash, 'correct-horse-battery-staple');
  assert.equal(valid.valid, true);
});

test('legacy bcrypt hashes can be verified and marked for upgrade', async () => {
  const legacyHash = await bcrypt.hash('legacy-password', 10);
  const result = await verifyPassword(legacyHash, 'legacy-password');

  assert.equal(result.valid, true);
  assert.equal(result.needsUpgrade, true);
});
