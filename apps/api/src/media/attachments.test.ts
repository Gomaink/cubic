import assert from 'node:assert/strict';
import { lstat, readdir, rm, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import {
  attachmentDeliveryPolicy,
  AttachmentStorageReserveError,
  AttachmentStore,
  safeAttachmentContentDisposition
} from './attachments.js';

async function temporaryStore(context: test.TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'cubic-attachment-test-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  return new AttachmentStore(root);
}

test('normal files stream to storage and are detected from content', async (context) => {
  const store = await temporaryStore(context);
  const stored = await store.save(Readable.from([Buffer.from('%PDF-example')]), {
    originalName: '../report.pdf',
    claimedMime: 'text/html',
    maxBytes: 1024
  });
  assert.deepEqual(await readdir(store.root), ['.staging']);
  assert.deepEqual(await readdir(store.stagingRoot), [stored.key]);
  await store.publish(stored.key);

  assert.equal(stored.originalName, 'report.pdf');
  assert.equal(stored.contentType, 'application/pdf');
  assert.equal(stored.kind, 'document');
  assert.equal(await store.size(stored.key), stored.sizeBytes);
});

test('normal image, video, and generic file uploads retain signature-based kinds', async (context) => {
  const cases = [
    { data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), kind: 'image' },
    { data: Buffer.from([0, 0, 0, 0, 0x66, 0x74, 0x79, 0x70]), kind: 'video' },
    { data: Buffer.from([0, 1, 2, 3]), kind: 'file' }
  ] as const;

  for (const item of cases) {
    const store = await temporaryStore(context);
    const stored = await store.save(Readable.from([item.data]), {
      originalName: 'upload.bin',
      claimedMime: 'application/octet-stream',
      maxBytes: 1024
    });
    await store.publish(stored.key);
    assert.equal(stored.kind, item.kind);
  }
});

test('oversize, empty, and interrupted streams leave no attachment file', async (context) => {
  const cases = [
    { stream: Readable.from([Buffer.alloc(8)]), maxBytes: 4 },
    { stream: Readable.from([]), maxBytes: 1024 },
    {
      stream: new Readable({
        read() {
          this.push(Buffer.from('partial'));
          this.destroy(new Error('client disconnected'));
        }
      }),
      maxBytes: 1024
    }
  ];

  for (const { stream, maxBytes } of cases) {
    const store = await temporaryStore(context);
    await assert.rejects(() => store.save(stream, {
      originalName: 'file.bin',
      claimedMime: 'application/octet-stream',
      maxBytes
    }));
    assert.deepEqual(await readdir(store.root), ['.staging']);
    assert.deepEqual(await readdir(store.stagingRoot), []);
  }
});

test('minimum-free-space guard measures the attachment filesystem and preserves existing files', async (context) => {
  const store = await temporaryStore(context);
  const stored = await store.save(Readable.from([Buffer.from('kept')]), {
    originalName: 'kept.bin',
    claimedMime: 'application/octet-stream',
    maxBytes: 1024
  });
  await store.publish(stored.key);

  await assert.rejects(
    () => store.assertFreeSpace(Number.MAX_SAFE_INTEGER, 1024 * 1024),
    AttachmentStorageReserveError
  );
  assert.equal(await store.size(stored.key), 4);
});

test('publication atomically moves a completed staging file into final storage', async (context) => {
  const store = await temporaryStore(context);
  const stored = await store.save(Readable.from([Buffer.from('complete')]), {
    originalName: 'complete.bin',
    claimedMime: 'application/octet-stream',
    maxBytes: 1024
  });

  assert.equal((await store.inspect(stored.key, 'staging')).exists, true);
  assert.equal((await store.inspect(stored.key, 'final')).exists, false);
  await store.publish(stored.key);
  assert.equal((await store.inspect(stored.key, 'staging')).exists, false);
  assert.equal((await store.inspect(stored.key, 'final')).exists, true);
});

test('attachment deletion rejects traversal, malformed keys, and symlinks without removing them', async (context) => {
  const store = await temporaryStore(context);
  await store.prepare();
  const target = join(store.root, 'outside.txt');
  await writeFile(target, 'preserved');
  const linkKey = '00000000-0000-4000-8000-000000000001';
  const linkPath = join(store.root, linkKey);
  await symlink(target, linkPath);

  await assert.rejects(() => store.delete('../outside.txt'), /Invalid attachment key/);
  await assert.rejects(
    () => store.delete(linkKey),
    (error: unknown) => (error as NodeJS.ErrnoException).code === 'CUBIC_ATTACHMENT_UNSAFE_ENTRY'
  );
  assert.equal((await lstat(linkPath)).isSymbolicLink(), true);
  assert.equal((await lstat(target)).isFile(), true);
});

test('opening attachment content never follows a symlink', async (context) => {
  const store = await temporaryStore(context);
  await store.prepare();
  const target = join(store.root, 'secret.txt');
  await writeFile(target, 'secret');
  const linkKey = '00000000-0000-4000-8000-000000000002';
  await symlink(target, join(store.root, linkKey));

  await assert.rejects(
    () => store.open(linkKey),
    (error: unknown) => ['ELOOP', 'CUBIC_ATTACHMENT_UNSAFE_ENTRY'].includes(
      (error as NodeJS.ErrnoException).code ?? ''
    )
  );
  await assert.rejects(() => store.detectForDelivery(linkKey, 'image/png'));
});

test('delivery re-sniffs stored bytes and never trusts malicious MIME metadata', async (context) => {
  const store = await temporaryStore(context);
  const stored = await store.save(Readable.from([Buffer.from('<script>alert(1)</script>')]), {
    originalName: 'payload.html',
    claimedMime: 'text/html',
    maxBytes: 1024
  });
  await store.publish(stored.key);
  const detected = await store.detectForDelivery(stored.key, 'image/png');
  assert.equal(detected, 'application/octet-stream');
  assert.deepEqual(attachmentDeliveryPolicy(detected), {
    contentType: 'application/octet-stream',
    disposition: 'attachment'
  });
  assert.equal(attachmentDeliveryPolicy('application/pdf').disposition, 'attachment');
  assert.equal(attachmentDeliveryPolicy('image/png').disposition, 'inline');
});

test('delivery filenames are bounded and safe for ASCII and RFC 5987 headers', () => {
  const header = safeAttachmentContentDisposition(
    '../evil\r\nX-Test: yes\\\u202ereport.txt',
    'attachment'
  );
  assert.match(header, /^attachment; filename="[\x20-\x7e]+"; filename\*=UTF-8''/);
  assert.doesNotMatch(header, /[\r\n\u202e\\/]/u);

  const unicode = safeAttachmentContentDisposition('résumé 日本語.pdf', 'attachment');
  assert.match(unicode, /filename="resume ___\.pdf"/);
  assert.match(unicode, /filename\*=UTF-8''r%C3%A9sum%C3%A9%20%E6%97%A5%E6%9C%AC%E8%AA%9E\.pdf/);
  assert.ok(Buffer.byteLength(unicode, 'utf8') < 700);
});
