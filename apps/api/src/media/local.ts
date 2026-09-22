import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, unlink, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

export type StoredImage = {
  key: string;
  contentType: 'image/png' | 'image/jpeg' | 'image/webp';
};
export type StoredUserImage = { key: string; contentType: StoredImage['contentType'] | 'image/gif' };

function detectImage(buffer: Buffer): StoredImage['contentType'] | null {
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47 &&
    buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a
  ) return 'image/png';

  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }

  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) return 'image/webp';

  return null;
}

function detectUserImage(buffer: Buffer): StoredUserImage['contentType'] | null {
  const staticType = detectImage(buffer);
  if (staticType) return staticType;
  if (buffer.length >= 14 &&
      (buffer.subarray(0, 6).toString('ascii') === 'GIF87a' || buffer.subarray(0, 6).toString('ascii') === 'GIF89a') &&
      buffer.readUInt16LE(6) > 0 && buffer.readUInt16LE(8) > 0 && buffer[buffer.length - 1] === 0x3b) {
    return 'image/gif';
  }
  return null;
}

function extensionFor(contentType: StoredImage['contentType']): string {
  if (contentType === 'image/png') return 'png';
  if (contentType === 'image/jpeg') return 'jpg';
  return 'webp';
}

function contentTypeForKey(key: string): StoredImage['contentType'] | null {
  if (key.endsWith('.png')) return 'image/png';
  if (key.endsWith('.jpg')) return 'image/jpeg';
  if (key.endsWith('.webp')) return 'image/webp';
  return null;
}

function safeKey(key: string): string {
  const normalized = basename(key);
  if (
    normalized !== key ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(png|jpg|webp)$/i.test(normalized)
  ) {
    throw new Error('Invalid media key.');
  }
  return normalized;
}

export class LocalMediaStore {
  readonly root: string;
  readonly groupAvatarRoot: string;
  readonly userAvatarRoot: string;

  constructor(root: string, readonly userAvatarMaxBytes = 2 * 1024 * 1024) {
    this.root = root;
    this.groupAvatarRoot = join(root, 'group-avatars');
    this.userAvatarRoot = join(root, 'user-avatars');
  }

  async saveGroupAvatar(buffer: Buffer): Promise<StoredImage> {
    const contentType = detectImage(buffer);
    if (!contentType) throw new Error('Unsupported image format.');

    await mkdir(this.groupAvatarRoot, { recursive: true });
    const key = `${randomUUID()}.${extensionFor(contentType)}`;
    await writeFile(join(this.groupAvatarRoot, key), buffer, { mode: 0o640 });
    return { key, contentType };
  }

  async readGroupAvatar(key: string): Promise<{ buffer: Buffer; contentType: StoredImage['contentType'] }> {
    const normalized = safeKey(key);
    const expectedContentType = contentTypeForKey(normalized);
    if (!expectedContentType) throw new Error('Unsupported image format.');

    const handle = await open(
      join(this.groupAvatarRoot, normalized),
      constants.O_RDONLY | constants.O_NOFOLLOW
    );
    try {
      const metadata = await handle.stat();
      if (!metadata.isFile()) throw new Error('Unsafe group avatar entry.');
      const buffer = await handle.readFile();
      const detectedContentType = detectImage(buffer);
      if (detectedContentType !== expectedContentType) throw new Error('Group avatar type mismatch.');
      return { buffer, contentType: detectedContentType };
    } finally {
      await handle.close().catch(() => {});
    }
  }

  async deleteGroupAvatar(key: string | null | undefined): Promise<void> {
    if (!key) return;
    const normalized = safeKey(key);
    try {
      await unlink(join(this.groupAvatarRoot, normalized));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  async saveUserAvatar(buffer: Buffer): Promise<StoredUserImage> {
    if (buffer.length > this.userAvatarMaxBytes) throw new Error('Avatar is too large.');
    const contentType = detectUserImage(buffer);
    if (!contentType) throw new Error('Unsupported image format.');
    await mkdir(this.userAvatarRoot, { recursive: true });
    const key = `${randomUUID()}.${contentType === 'image/gif' ? 'gif' : extensionFor(contentType)}`;
    await writeFile(join(this.userAvatarRoot, key), buffer, { flag: 'wx', mode: 0o640 });
    return { key, contentType };
  }

  async readUserAvatar(key: string): Promise<{ buffer: Buffer; contentType: StoredUserImage['contentType'] }> {
    const normalized = safeUserKey(key);
    const expected = normalized.endsWith('.gif') ? 'image/gif' : contentTypeForKey(normalized);
    const handle = await open(join(this.userAvatarRoot, normalized), constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const metadata = await handle.stat();
      if (!metadata.isFile() || metadata.size > this.userAvatarMaxBytes) throw new Error('Unsafe user avatar entry.');
      const buffer = await handle.readFile();
      const detected = detectUserImage(buffer);
      if (!detected || detected !== expected) throw new Error('User avatar type mismatch.');
      return { buffer, contentType: detected };
    } finally {
      await handle.close().catch(() => {});
    }
  }

  async deleteUserAvatar(key: string | null | undefined): Promise<void> {
    if (!key) return;
    const normalized = safeUserKey(key);
    try {
      await unlink(join(this.userAvatarRoot, normalized));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
}

function safeUserKey(key: string): string {
  if (basename(key) !== key || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(png|jpg|webp|gif)$/iu.test(key)) {
    throw new Error('Invalid user avatar key.');
  }
  return key;
}

export const mediaInternals = { detectImage, detectUserImage, safeKey, safeUserKey };
