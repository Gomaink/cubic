// Append new entries with a new bit. Never renumber or reuse a published bit.
export const SERVER_PERMISSION_BITS = {
  VIEW_SERVER: 0,
  MANAGE_SERVER: 1,
  MANAGE_ROLES: 2,
  MANAGE_CHANNELS: 3,
  MANAGE_INVITES: 4,
  KICK_MEMBERS: 5,
  SEND_MESSAGES: 6,
  MANAGE_MESSAGES: 7,
  CONNECT: 8,
  SPEAK: 9,
  VIDEO: 10,
  SCREEN_SHARE: 11
} as const;

export type ServerPermissionName = keyof typeof SERVER_PERMISSION_BITS;

export function parseServerPermissionName(value: unknown): ServerPermissionName | null {
  return typeof value === 'string' && Object.hasOwn(SERVER_PERMISSION_BITS, value)
    ? value as ServerPermissionName
    : null;
}
