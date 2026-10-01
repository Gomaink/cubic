export const CUBIC_VERSION = '2.0.0-alpha.7' as const;
export const CUBIC_NAME = 'Cubic' as const;

export type HealthStatus = 'ok' | 'degraded';
export type UserTheme = 'dark' | 'light' | 'system';

export interface PublicUser {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  createdAt: string;
}

export interface UserSettingsPayload {
  theme: UserTheme;
  compactMode: boolean;
  reduceMotion: boolean;
  inputVolume: number;
  outputVolume: number;
}

export interface AuthResponse {
  user: PublicUser;
}

// Server roles are read-only in Alpha 12.1. Ownership remains on the server.
export interface ServerRole {
  id: string;
  serverId: string;
  name: string;
  position: number;
  isDefault: boolean;
}

export interface ServerRolesResponse {
  roles: ServerRole[];
}

export interface HealthResponse {
  status: HealthStatus;
  service: 'cubic-api';
  version: typeof CUBIC_VERSION;
  database: 'up' | 'down';
  auth: 'ready';
  conversations?: 'ready';
  timestamp: string;
}
