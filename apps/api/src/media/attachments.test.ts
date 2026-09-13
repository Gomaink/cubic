import assert from 'node:assert/strict';
import { readdir, rm, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import {
  AttachmentStorageReserveError,
  AttachmentStore
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
    assert.deepEqual(await readdir(store.root), []);
  }
});

test('minimum-free-space guard measures the attachment filesystem and preserves existing files', async (context) => {
  const store = await temporaryStore(context);
  const stored = await store.save(Readable.from([Buffer.from('kept')]), {
    originalName: 'kept.bin',
    claimedMime: 'application/octet-stream',
    maxBytes: 1024
  });

  await assert.rejects(
    () => store.assertFreeSpace(Number.MAX_SAFE_INTEGER, 1024 * 1024),
    AttachmentStorageReserveError
  );
  assert.equal(await store.size(stored.key), 4);
});
