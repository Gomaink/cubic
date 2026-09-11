import { randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, open, stat, unlink } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export type AttachmentKind =
  | 'image'
  | 'video'
  | 'audio'
  | 'document'
  | 'archive'
  | 'file';

export type StoredAttachment = {
  key: string;
  originalName: string;
  contentType: string;
  kind: AttachmentKind;
  sizeBytes: number;
  width: number | null;
  height: number | null;
};

function safeAttachmentKey(key: string): string {
  const normalized = basename(key);
  if (
    normalized !== key ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)
  ) {
    throw new Error('Invalid attachment key.');
  }
  return normalized;
}

function sanitizeFileName(name: string): string {
  const normalized = basename(name || 'attachment')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/]/g, '_')
    .trim()
    .slice(0, 255);

  return normalized || 'attachment';
}

function jpegDimensions(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;

  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    const marker = buffer[offset + 1];
    offset += 2;

    if (marker === 0xd8 || marker === 0xd9) continue;
    if (offset + 2 > buffer.length) break;

    const length = buffer.readUInt16BE(offset);
    if (length < 2 || offset + length > buffer.length) break;

    if (
      marker === 0xc0 || marker === 0xc1 || marker === 0xc2 ||
      marker === 0xc3 || marker === 0xc5 || marker === 0xc6 ||
      marker === 0xc7 || marker === 0xc9 || marker === 0xca ||
      marker === 0xcb || marker === 0xcd || marker === 0xce ||
      marker === 0xcf
    ) {
      if (offset + 7 <= buffer.length) {
        return {
          height: buffer.readUInt16BE(offset + 3),
          width: buffer.readUInt16BE(offset + 5)
        };
      }
      return null;
    }

    offset += length;
  }

  return null;
}

function detectAttachment(
  buffer: Buffer,
  claimedMime: string
): Omit<StoredAttachment, 'key' | 'originalName' | 'sizeBytes'> {
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return {
      contentType: 'image/png',
      kind: 'image',
      width: buffer.length >= 24 ? buffer.readUInt32BE(16) : null,
      height: buffer.length >= 24 ? buffer.readUInt32BE(20) : null
    };
  }

  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    const dimensions = jpegDimensions(buffer);
    return {
      contentType: 'image/jpeg',
      kind: 'image',
      width: dimensions?.width ?? null,
      height: dimensions?.height ?? null
    };
  }

  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return {
      contentType: 'image/webp',
      kind: 'image',
      width: null,
      height: null
    };
  }

  if (
    buffer.length >= 10 &&
    (
      buffer.subarray(0, 6).toString('ascii') === 'GIF87a' ||
      buffer.subarray(0, 6).toString('ascii') === 'GIF89a'
    )
  ) {
    return {
      contentType: 'image/gif',
      kind: 'image',
      width: buffer.readUInt16LE(6),
      height: buffer.readUInt16LE(8)
    };
  }

  if (
    buffer.length >= 8 &&
    buffer.subarray(4, 8).toString('ascii') === 'ftyp'
  ) {
    return {
      contentType: 'video/mp4',
      kind: 'video',
      width: null,
      height: null
    };
  }

  if (
    buffer.length >= 4 &&
    buffer[0] === 0x1a &&
    buffer[1] === 0x45 &&
    buffer[2] === 0xdf &&
    buffer[3] === 0xa3
  ) {
    return {
      contentType: 'video/webm',
      kind: 'video',
      width: null,
      height: null
    };
  }

  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WAVE'
  ) {
    return {
      contentType: 'audio/wav',
      kind: 'audio',
      width: null,
      height: null
    };
  }

  if (
    buffer.length >= 4 &&
    buffer.subarray(0, 4).toString('ascii') === 'OggS'
  ) {
    const contentType = claimedMime.startsWith('video/')
      ? 'video/ogg'
      : 'audio/ogg';

    return {
      contentType,
      kind: contentType.startsWith('video/') ? 'video' : 'audio',
      width: null,
      height: null
    };
  }

  if (
    (buffer.length >= 3 && buffer.subarray(0, 3).toString('ascii') === 'ID3') ||
    (
      buffer.length >= 2 &&
      buffer[0] === 0xff &&
      (buffer[1]! & 0xe0) === 0xe0
    )
  ) {
    return {
      contentType: 'audio/mpeg',
      kind: 'audio',
      width: null,
      height: null
    };
  }

  if (
    buffer.length >= 5 &&
    buffer.subarray(0, 5).toString('ascii') === '%PDF-'
  ) {
    return {
      contentType: 'application/pdf',
      kind: 'document',
      width: null,
      height: null
    };
  }

  if (
    buffer.length >= 4 &&
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    (buffer[2] === 0x03 || buffer[2] === 0x05 || buffer[2] === 0x07) &&
    (buffer[3] === 0x04 || buffer[3] === 0x06 || buffer[3] === 0x08)
  ) {
    return {
      contentType: 'application/zip',
      kind: 'archive',
      width: null,
      height: null
    };
  }

  const hasNullByte = buffer
    .subarray(0, Math.min(buffer.length, 8192))
    .includes(0);

  const safeTextTypes = new Set([
    'text/plain',
    'text/csv',
    'text/markdown',
    'application/json'
  ]);

  if (!hasNullByte && safeTextTypes.has(claimedMime)) {
    return {
      contentType: claimedMime,
      kind: 'document',
      width: null,
      height: null
    };
  }

  return {
    contentType: 'application/octet-stream',
    kind: 'file',
    width: null,
    height: null
  };
}

export class AttachmentStore {
  readonly root: string;

  constructor(mediaRoot: string) {
    this.root = join(mediaRoot, 'attachments');
  }

  async save(
    stream: Readable,
    options: {
      originalName: string;
      claimedMime: string;
      maxBytes: number;
    }
  ): Promise<StoredAttachment> {
    await mkdir(this.root, { recursive: true });

    const key = randomUUID();
    const target = join(this.root, key);
    let sizeBytes = 0;

    const limiter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        sizeBytes += chunk.length;
        if (sizeBytes > options.maxBytes) {
          const error = new Error('Attachment is too large.') as NodeJS.ErrnoException;
          error.code = 'CUBIC_ATTACHMENT_TOO_LARGE';
          callback(error);
          return;
        }
        callback(null, chunk);
      }
    });

    try {
      await pipeline(
        stream,
        limiter,
        createWriteStream(target, { flags: 'wx', mode: 0o640 })
      );

      if (sizeBytes < 1) throw new Error('Attachment is empty.');

      const sniffLength = Math.min(sizeBytes, 64 * 1024);
      const sniffBuffer = Buffer.alloc(sniffLength);
      const handle = await open(target, 'r');

      let bytesRead = 0;
      try {
        ({ bytesRead } = await handle.read(sniffBuffer, 0, sniffLength, 0));
      } finally {
        await handle.close();
      }

      const detected = detectAttachment(
        sniffBuffer.subarray(0, bytesRead),
        options.claimedMime.toLowerCase()
      );

      return {
        key,
        originalName: sanitizeFileName(options.originalName),
        contentType: detected.contentType,
        kind: detected.kind,
        sizeBytes,
        width: detected.width,
        height: detected.height
      };
    } catch (error) {
      await unlink(target).catch(() => {});
      throw error;
    }
  }

  open(key: string) {
    return createReadStream(join(this.root, safeAttachmentKey(key)));
  }

  async size(key: string): Promise<number> {
    const metadata = await stat(join(this.root, safeAttachmentKey(key)));
    return metadata.size;
  }

  async delete(key: string | null | undefined): Promise<void> {
    if (!key) return;

    try {
      await unlink(join(this.root, safeAttachmentKey(key)));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
}

export const attachmentInternals = {
  safeAttachmentKey,
  sanitizeFileName,
  detectAttachment,
  jpegDimensions
};
