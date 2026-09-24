import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import sharp from 'sharp';
import { canonicalServerIcon, ServerIconStore, SERVER_ICON_MAX_BYTES } from './storage.js';

test('JPEG, PNG and WebP decode into one square canonical WebP', async () => {
  for (const format of ['jpeg', 'png', 'webp'] as const) {
    const input = await sharp({ create: { width: 320, height: 180, channels: 3, background: 'red' } })[format]().toBuffer();
    const output = await canonicalServerIcon(input);
    const metadata = await sharp(output).metadata();
    assert.equal(metadata.format, 'webp');
    assert.equal(metadata.width, 512);
    assert.equal(metadata.height, 512);
  }
});

test('hostile and unsupported icon input is rejected by actual decoding', async () => {
  const gif = Buffer.from('R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=', 'base64');
  for (const input of [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), gif, Buffer.from('not an image'), Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(SERVER_ICON_MAX_BYTES + 1)]) {
    await assert.rejects(canonicalServerIcon(input));
  }
  for (const [width, height] of [[4097, 1], [1, 4097]] as const) {
    const input = await sharp({ create: { width, height, channels: 3, background: 'blue' } }).png().toBuffer();
    await assert.rejects(canonicalServerIcon(input));
  }
});

test('icon files use an isolated namespace, temporary staging and safe key reads', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cubic-icon-store-'));
  try {
    const store = new ServerIconStore(root);
    const original = await sharp({ create: { width: 8, height: 8, channels: 3, background: 'green' } }).png().toBuffer();
    const canonical = await canonicalServerIcon(original);
    const temp = await store.writeTemp(canonical);
    const key = await store.publish(temp);
    assert.deepEqual(await store.read(key), canonical);
    await assert.rejects(store.read('../outside.webp'));
    await assert.rejects(store.deleteCanonical('../outside.webp'));
    await assert.rejects(store.deleteTemp('../outside.tmp'));
    assert.deepEqual(await readFile(join(store.root, key)), canonical);
    const outside = join(root, 'outside.webp');
    await symlink(outside, join(store.root, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.webp'));
    await assert.rejects(store.read('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.webp'));
  } finally { await rm(root, { recursive: true, force: true }); }
});
