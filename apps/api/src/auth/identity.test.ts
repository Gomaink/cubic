import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { managedUserAvatarKey, managedUserAvatarUrl, normalizeEmail, normalizeLegacyAvatarUrl, normalizeUsername } from './identity.js';

test('identity normalization is deterministic', () => {
  assert.equal(normalizeEmail('  User@Example.COM '), 'user@example.com');
  assert.equal(normalizeUsername(' Samuel_01 '), 'samuel_01');
});

test('legacy avatar URLs allow only bounded credential-free HTTPS URLs', () => {
  assert.equal(
    normalizeLegacyAvatarUrl('https://cdn.example/avatar.png'),
    'https://cdn.example/avatar.png'
  );
  for (const value of [
    'http://cdn.example/avatar.png',
    'data:image/png;base64,AAAA',
    'blob:https://cubic.example/id',
    'file:///tmp/avatar.png',
    'javascript:alert(1)',
    '//cdn.example/avatar.png',
    'https://user:password@cdn.example/avatar.png',
    'https://cdn.example/avatar.png\nscript',
    'not a URL',
    `https://cdn.example/${'a'.repeat(2_048)}`
  ]) assert.equal(normalizeLegacyAvatarUrl(value), null);
});

test('only exact managed user-avatar URLs are accepted alongside legacy HTTPS avatars', () => {
  const userId = '123e4567-e89b-42d3-a456-426614174000';
  const key = '123e4567-e89b-42d3-a456-426614174001.gif';
  const url = managedUserAvatarUrl(userId, key);
  assert.equal(normalizeLegacyAvatarUrl(url), url);
  assert.equal(managedUserAvatarKey(url, userId), key);
  for (const unsafe of [`${url}?x=1`, `${url}#fragment`, `${url}/other`, url.replace('/api/', '//api/')]) {
    assert.equal(normalizeLegacyAvatarUrl(unsafe), null);
  }
  assert.equal(managedUserAvatarKey(url, '123e4567-e89b-42d3-a456-426614174002'), null);
});

test('legacy import and every raw-SQL avatar DTO use the central validator', async () => {
  const files = [
    '../../src/cli/import-v1-users.ts',
    '../../src/routes/social.ts',
    '../../src/routes/groups.ts',
    '../../src/routes/conversations.ts',
    '../../src/routes/call-history.ts'
  ];
  for (const path of files) {
    const source = await readFile(new URL(path, import.meta.url), 'utf8');
    assert.match(source, /normalizeLegacyAvatarUrl/u, `${path} must filter avatar URLs`);
  }
});
