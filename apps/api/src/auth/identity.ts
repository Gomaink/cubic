import type { PublicUser } from '@cubic/shared';
import { users } from '@cubic/database/schema';

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function normalizeUsername(value: string): string {
  return value.trim().toLowerCase();
}

const MAX_AVATAR_URL_LENGTH = 2_048;
const UNSAFE_URL_CHARACTERS = /[\u0000-\u0020\u007f]/u;
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const MANAGED_USER_AVATAR = new RegExp(`^/api/v1/users/(${UUID})/avatar/(${UUID}\\.(?:png|jpg|webp|gif))$`, 'iu');

export function managedUserAvatarUrl(userId: string, key: string): string {
  const url = `/api/v1/users/${userId}/avatar/${key}`;
  if (!MANAGED_USER_AVATAR.test(url)) throw new Error('Invalid user avatar reference.');
  return url;
}

export function managedUserAvatarKey(value: unknown, userId: string): string | null {
  if (typeof value !== 'string') return null;
  const match = MANAGED_USER_AVATAR.exec(value);
  return match?.[1]?.toLowerCase() === userId.toLowerCase() ? match?.[2] ?? null : null;
}

export function normalizeLegacyAvatarUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_AVATAR_URL_LENGTH) return null;
  if (UNSAFE_URL_CHARACTERS.test(value)) return null;
  if (MANAGED_USER_AVATAR.test(value)) return value;

  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.origin === 'null') return null;
    return parsed.href;
  } catch {
    return null;
  }
}

export function toPublicUser(user: typeof users.$inferSelect): PublicUser {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    avatarUrl: normalizeLegacyAvatarUrl(user.avatarUrl),
    createdAt: user.createdAt.toISOString()
  };
}
