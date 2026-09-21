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

export function normalizeLegacyAvatarUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_AVATAR_URL_LENGTH) return null;
  if (UNSAFE_URL_CHARACTERS.test(value)) return null;

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
