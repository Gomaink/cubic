export const CUBIC_VERSION = '2.0.0-alpha.1' as const;
export const CUBIC_NAME = 'Cubic' as const;

export type HealthStatus = 'ok' | 'degraded';

export interface HealthResponse {
  status: HealthStatus;
  service: 'cubic-api';
  version: typeof CUBIC_VERSION;
  database: 'up' | 'down';
  timestamp: string;
}
