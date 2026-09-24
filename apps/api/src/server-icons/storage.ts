import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, rename, lstat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';

export const SERVER_ICON_MAX_BYTES = 5 * 1024 * 1024;
export const SERVER_ICON_MAX_DIMENSION = 4096;
const KEY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$/;
const TEMP_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.tmp$/;

export function isServerIconKey(key: string): boolean { return KEY_PATTERN.test(key); }
export function isServerIconTempName(name: string): boolean { return TEMP_PATTERN.test(name); }

function hasAcceptedImageSignature(input: Buffer): boolean {
  return (input.length >= 3 && input[0] === 0xff && input[1] === 0xd8 && input[2] === 0xff) ||
    (input.length >= 8 && input.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) ||
    (input.length >= 12 && input.toString('ascii', 0, 4) === 'RIFF' && input.toString('ascii', 8, 12) === 'WEBP');
}

export class InvalidServerIconError extends Error {}

export async function canonicalServerIcon(input: Buffer): Promise<Buffer> {
  if (!input.length || input.length > SERVER_ICON_MAX_BYTES || !hasAcceptedImageSignature(input)) {
    throw new InvalidServerIconError('Invalid icon input.');
  }
  try {
    const image = sharp(input, { failOn: 'error', limitInputPixels: SERVER_ICON_MAX_DIMENSION ** 2, animated: false });
    const metadata = await image.metadata();
    if (!['jpeg', 'png', 'webp'].includes(metadata.format ?? '') ||
        !metadata.width || !metadata.height ||
        metadata.width > SERVER_ICON_MAX_DIMENSION || metadata.height > SERVER_ICON_MAX_DIMENSION ||
        (metadata.pages ?? 1) > 1) {
      throw new InvalidServerIconError('Invalid icon input.');
    }
    return await image.rotate().resize(512, 512, { fit: 'cover', position: 'centre' }).webp().toBuffer();
  } catch {
    throw new InvalidServerIconError('Invalid icon input.');
  }
}

export class ServerIconStore {
  readonly root: string;
  readonly tempRoot: string;

  constructor(mediaRoot: string) {
    this.root = join(mediaRoot, 'server-icons');
    this.tempRoot = join(this.root, '.tmp');
  }

  async prepare(): Promise<void> {
    await mkdir(this.tempRoot, { recursive: true });
    for (const directory of [this.root, this.tempRoot]) {
      const entry = await lstat(directory);
      if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error('Unsafe server icon directory.');
    }
  }

  async writeTemp(bytes: Buffer): Promise<string> {
    await this.prepare();
    const name = `${randomUUID()}.tmp`;
    const handle = await open(join(this.tempRoot, name), 'wx', 0o640);
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } catch (error) {
      await handle.close().catch(() => {});
      await this.deleteTemp(name).catch(() => {});
      throw error;
    }
    await handle.close();
    return name;
  }

  async publish(tempName: string): Promise<string> {
    if (!isServerIconTempName(tempName)) throw new Error('Invalid temporary icon name.');
    const key = `${randomUUID()}.webp`;
    // Keys are random and never reused. Refuse an existing target rather than overwriting it.
    try {
      await lstat(join(this.root, key));
      throw new Error('Icon key collision.');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    await rename(join(this.tempRoot, tempName), join(this.root, key));
    return key;
  }

  async read(key: string): Promise<Buffer> {
    if (!isServerIconKey(key)) throw new Error('Invalid icon key.');
    const handle = await open(join(this.root, key), constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > SERVER_ICON_MAX_BYTES) throw new Error('Unsafe icon file.');
      return await handle.readFile();
    } finally { await handle.close().catch(() => {}); }
  }

  async deleteCanonical(key: string | null): Promise<void> {
    if (!key) return;
    if (!isServerIconKey(key)) throw new Error('Invalid icon key.');
    try { await unlink(join(this.root, key)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }

  async deleteTemp(name: string): Promise<void> {
    if (!isServerIconTempName(name)) throw new Error('Invalid temporary icon name.');
    try { await unlink(join(this.tempRoot, name)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
}
