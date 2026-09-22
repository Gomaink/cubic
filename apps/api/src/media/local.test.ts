import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalMediaStore, mediaInternals } from './local.js';

test('detects supported group avatar signatures instead of trusting MIME', () => {
  assert.equal(mediaInternals.detectImage(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])), 'image/png');
  assert.equal(mediaInternals.detectImage(Buffer.from([0xff,0xd8,0xff,0x00])), 'image/jpeg');
  assert.equal(mediaInternals.detectImage(Buffer.from('RIFF0000WEBP')), 'image/webp');
  assert.equal(mediaInternals.detectImage(Buffer.from('<svg></svg>')), null);
});

test('media keys cannot escape the configured storage root', () => {
  assert.equal(mediaInternals.safeKey('123e4567-e89b-12d3-a456-426614174000.webp'), '123e4567-e89b-12d3-a456-426614174000.webp');
  assert.throws(() => mediaInternals.safeKey('../avatar.webp'));
  assert.throws(() => mediaInternals.safeKey('avatar.svg'));
});

test('group avatar reads re-sniff bytes and reject mismatches, symlinks, and non-files', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'cubic-group-avatar-test-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const store = new LocalMediaStore(root);
  await mkdir(store.groupAvatarRoot, { recursive: true });

  const goodKey = '123e4567-e89b-42d3-a456-426614174000.png';
  await writeFile(join(store.groupAvatarRoot, goodKey), Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]));
  assert.equal((await store.readGroupAvatar(goodKey)).contentType, 'image/png');

  const mismatchKey = '123e4567-e89b-42d3-a456-426614174001.jpg';
  await writeFile(join(store.groupAvatarRoot, mismatchKey), Buffer.from('<svg></svg>'));
  await assert.rejects(() => store.readGroupAvatar(mismatchKey), /type mismatch/);

  const symlinkKey = '123e4567-e89b-42d3-a456-426614174002.webp';
  await symlink(join(store.groupAvatarRoot, goodKey), join(store.groupAvatarRoot, symlinkKey));
  await assert.rejects(() => store.readGroupAvatar(symlinkKey));

  const directoryKey = '123e4567-e89b-42d3-a456-426614174003.png';
  await mkdir(join(store.groupAvatarRoot, directoryKey));
  await assert.rejects(() => store.readGroupAvatar(directoryKey), /Unsafe group avatar/);
});

test('user avatars preserve GIF bytes and reject tampered or unsafe media', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'cubic-user-avatar-test-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const store = new LocalMediaStore(root);
  const gif = Buffer.from('47494638396101000100800000000000ffffff21f90400000000002c000000000100010000020244010021f90400000000002c00000000010001000002024c01003b', 'hex');
  const saved = await store.saveUserAvatar(gif);
  assert.equal(saved.contentType, 'image/gif');
  assert.ok(saved.key.endsWith('.gif'));
  assert.deepEqual((await store.readUserAvatar(saved.key)).buffer, gif);
  assert.equal(mediaInternals.detectUserImage(Buffer.from('<svg></svg>')), null);
  await assert.rejects(() => store.saveUserAvatar(Buffer.from('<script>bad</script>')), /Unsupported image/);
  await assert.rejects(() => store.saveUserAvatar(Buffer.alloc(2 * 1024 * 1024 + 1)), /too large/);
  const mismatch = '123e4567-e89b-42d3-a456-426614174001.gif';
  await writeFile(join(store.userAvatarRoot, mismatch), Buffer.from('<html>not image</html>'));
  await assert.rejects(() => store.readUserAvatar(mismatch), /type mismatch/);
  const link = '123e4567-e89b-42d3-a456-426614174002.gif';
  await symlink(join(store.userAvatarRoot, saved.key), join(store.userAvatarRoot, link));
  await assert.rejects(() => store.readUserAvatar(link));
  await store.deleteUserAvatar(saved.key);
  await assert.rejects(() => store.readUserAvatar(saved.key));
});
