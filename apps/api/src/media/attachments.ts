import { randomUUID } from 'node:crypto';
import { constants, createWriteStream } from 'node:fs';
import { link, lstat, mkdir, open, rename, stat, statfs, unlink } from 'node:fs/promises';
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

export class AttachmentStorageReserveError extends Error {
  readonly code = 'CUBIC_ATTACHMENT_STORAGE_RESERVE';

  constructor(
    readonly availableBytes: bigint,
    readonly requiredBytes: bigint,
    readonly reserveBytes: bigint
  ) {
    super('Attachment storage reserve would be breached.');
  }
}

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

export function isManagedAttachmentKey(key: string): boolean {
  try {
    safeAttachmentKey(key);
    return true;
  } catch {
    return false;
  }
}

const STAGING_UPLOAD_SUFFIX = '.uploading';

export function stagingUploadKeyFromName(name: string): string | null {
  if (!name.endsWith(STAGING_UPLOAD_SUFFIX)) return null;
  const key = name.slice(0, -STAGING_UPLOAD_SUFFIX.length);
  return isManagedAttachmentKey(key) ? key : null;
}

function unsafeEntryError(): NodeJS.ErrnoException {
  const error = new Error('Unsafe attachment storage entry.') as NodeJS.ErrnoException;
  error.code = 'CUBIC_ATTACHMENT_UNSAFE_ENTRY';
  return error;
}

function sanitizeFileName(name: string): string {
  const normalized = basename(name || 'attachment')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/]/g, '_')
    .trim()
    .slice(0, 255);

  return normalized || 'attachment';
}

const FILE_NAME_CONTROLS = /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/gu;

function truncateUtf8(value: string, maxBytes: number): string {
  let result = '';
  for (const character of value) {
    const safeCharacter = /[\uD800-\uDFFF]/u.test(character) ? '_' : character;
    if (Buffer.byteLength(result + safeCharacter, 'utf8') > maxBytes) break;
    result += safeCharacter;
  }
  return result;
}

export function safeAttachmentContentDisposition(
  originalName: unknown,
  disposition: 'inline' | 'attachment'
): string {
  const source = typeof originalName === 'string' ? originalName : '';
  let unicodeName = source
    .normalize('NFC')
    .replace(FILE_NAME_CONTROLS, '')
    .replace(/[\\/]/gu, '_')
    .trim();
  if (!unicodeName || unicodeName === '.' || unicodeName === '..') unicodeName = 'attachment';
  unicodeName = unicodeName.replace(/^\.+/u, '_');
  unicodeName = truncateUtf8(unicodeName, 180) || 'attachment';

  let asciiName = unicodeName
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .replace(/[^A-Za-z0-9._ -]/gu, '_')
    .replace(/^\.+/u, '_')
    .trim()
    .slice(0, 100);
  if (!asciiName || asciiName === '.' || asciiName === '..') asciiName = 'attachment';

  const encodedName = encodeURIComponent(unicodeName)
    .replace(/['()*]/gu, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${disposition}; filename="${asciiName}"; filename*=UTF-8''${encodedName}`;
}

const INLINE_ATTACHMENT_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'audio/wav',
  'audio/ogg',
  'audio/mpeg',
  'video/mp4',
  'video/webm',
  'video/ogg'
]);

export function attachmentDeliveryPolicy(detectedContentType: string): {
  contentType: string;
  disposition: 'inline' | 'attachment';
} {
  if (INLINE_ATTACHMENT_TYPES.has(detectedContentType)) {
    return { contentType: detectedContentType, disposition: 'inline' };
  }
  if (
    detectedContentType === 'application/pdf' ||
    detectedContentType === 'application/zip' ||
    detectedContentType === 'text/plain' ||
    detectedContentType === 'text/csv' ||
    detectedContentType === 'text/markdown' ||
    detectedContentType === 'application/json'
  ) {
    return { contentType: detectedContentType, disposition: 'attachment' };
  }
  return { contentType: 'application/octet-stream', disposition: 'attachment' };
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
  readonly stagingRoot: string;

  constructor(mediaRoot: string) {
    this.root = join(mediaRoot, 'attachments');
    this.stagingRoot = join(this.root, '.staging');
  }

  async prepare(): Promise<void> {
    await mkdir(this.stagingRoot, { recursive: true });
    await statfs(this.root, { bigint: true });
  }

  async assertFreeSpace(requiredBytes: number, reserveBytes: number): Promise<void> {
    await mkdir(this.root, { recursive: true });
    const filesystem = await statfs(this.root, { bigint: true });
    const availableBytes = filesystem.bavail * filesystem.bsize;
    const required = BigInt(requiredBytes);
    const reserve = BigInt(reserveBytes);

    if (availableBytes < required + reserve) {
      throw new AttachmentStorageReserveError(availableBytes, required, reserve);
    }
  }

  async save(
    stream: Readable,
    options: {
      originalName: string;
      claimedMime: string;
      maxBytes: number;
    }
  ): Promise<StoredAttachment> {
    await mkdir(this.stagingRoot, { recursive: true });

    const key = randomUUID();
    const target = join(this.stagingRoot, `${key}.uploading`);
    const stagedTarget = join(this.stagingRoot, key);
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

      await rename(target, stagedTarget);

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
      await unlink(stagedTarget).catch(() => {});
      throw error;
    }
  }

  async publish(key: string): Promise<void> {
    const normalized = safeAttachmentKey(key);
    const staged = join(this.stagingRoot, normalized);
    await link(staged, join(this.root, normalized));
    await unlink(staged);
  }

  async discardStaged(key: string | null | undefined): Promise<void> {
    if (!key) return;
    await this.deleteManagedFile(this.stagingRoot, safeAttachmentKey(key));
  }

  async discardStagingUpload(key: string): Promise<void> {
    await this.deleteManagedFile(
      this.stagingRoot,
      `${safeAttachmentKey(key)}${STAGING_UPLOAD_SUFFIX}`
    );
  }

  async open(key: string) {
    const normalized = safeAttachmentKey(key);
    const handle = await open(
      join(this.root, normalized),
      constants.O_RDONLY | constants.O_NOFOLLOW
    );

    try {
      const metadata = await handle.stat();
      if (!metadata.isFile()) throw unsafeEntryError();
      return handle.createReadStream({ autoClose: true });
    } catch (error) {
      await handle.close().catch(() => {});
      throw error;
    }
  }

  async detectForDelivery(key: string, claimedMime: string): Promise<string> {
    const normalized = safeAttachmentKey(key);
    const handle = await open(
      join(this.root, normalized),
      constants.O_RDONLY | constants.O_NOFOLLOW
    );
    try {
      const metadata = await handle.stat();
      if (!metadata.isFile()) throw unsafeEntryError();
      const sniffLength = Math.min(metadata.size, 64 * 1024);
      const sniffBuffer = Buffer.alloc(sniffLength);
      const { bytesRead } = await handle.read(sniffBuffer, 0, sniffLength, 0);
      return detectAttachment(
        sniffBuffer.subarray(0, bytesRead),
        claimedMime.toLowerCase()
      ).contentType;
    } finally {
      await handle.close().catch(() => {});
    }
  }

  async size(key: string): Promise<number> {
    const metadata = await stat(join(this.root, safeAttachmentKey(key)));
    return metadata.size;
  }

  async delete(key: string | null | undefined): Promise<void> {
    if (!key) return;
    await this.deleteManagedFile(this.root, safeAttachmentKey(key));
  }

  async inspect(
    key: string,
    location: 'final' | 'staging' = 'final'
  ): Promise<{ exists: boolean; regular: boolean; modifiedAtMs: number }> {
    const normalized = safeAttachmentKey(key);
    const directory = location === 'final' ? this.root : this.stagingRoot;
    return this.inspectPath(join(directory, normalized));
  }

  async inspectStagingUpload(
    key: string
  ): Promise<{ exists: boolean; regular: boolean; modifiedAtMs: number }> {
    const normalized = safeAttachmentKey(key);
    return this.inspectPath(join(this.stagingRoot, `${normalized}${STAGING_UPLOAD_SUFFIX}`));
  }

  private async inspectPath(
    target: string
  ): Promise<{ exists: boolean; regular: boolean; modifiedAtMs: number }> {
    try {
      const metadata = await lstat(target);
      return {
        exists: true,
        regular: metadata.isFile() && !metadata.isSymbolicLink(),
        modifiedAtMs: Math.max(metadata.mtimeMs, metadata.ctimeMs)
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { exists: false, regular: false, modifiedAtMs: 0 };
      }
      throw error;
    }
  }

  private async deleteManagedFile(directory: string, key: string): Promise<void> {
    const target = join(directory, key);
    try {
      const metadata = await lstat(target);
      if (!metadata.isFile() || metadata.isSymbolicLink()) throw unsafeEntryError();
      await unlink(target);
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
