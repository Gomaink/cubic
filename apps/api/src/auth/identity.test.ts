import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeEmail, normalizeUsername } from './identity.js';

test('identity normalization is deterministic', () => {
  assert.equal(normalizeEmail('  User@Example.COM '), 'user@example.com');
  assert.equal(normalizeUsername(' Samuel_01 '), 'samuel_01');
});
