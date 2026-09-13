import { z } from 'zod';
import { parseTrustedProxyCidrs } from './proxy.js';

const booleanString = z.enum(['true', 'false']).default('false').transform((value) => value === 'true');
const enabledString = z.enum(['true', 'false']).default('true').transform((value) => value === 'true');

export const ATTACHMENT_DEFAULTS = {
  maxBytes: 25 * 1024 * 1024,
  pendingMaxCount: 20,
  pendingMaxBytes: 250 * 1024 * 1024,
  minFreeBytes: 1024 * 1024 * 1024,
  uploadRateLimitMax: 20,
  uploadRateLimitWindowMs: 60 * 1000,
  cleanupIntervalMs: 15 * 60 * 1000,
  staleAgeMs: 24 * 60 * 60 * 1000,
  cleanupBatchSize: 250,
  deletionIntervalMs: 30 * 1000,
  deletionBatchSize: 100,
  deletionLeaseMs: 5 * 60 * 1000,
  deletionRetryBaseMs: 5 * 1000,
  deletionRetryMaxMs: 60 * 60 * 1000,
  reconciliationIntervalMs: 15 * 60 * 1000,
  orphanGraceMs: 24 * 60 * 60 * 1000,
  reconciliationScanBatchSize: 500,
  reconciliationMissingBatchSize: 250
} as const;

export const SESSION_DEFAULTS = {
  idleTimeoutMs: 7 * 24 * 60 * 60 * 1000,
  socketRevalidateMs: 5 * 60 * 1000
} as const;

function strictPositiveInteger(defaultValue: number, minimum: number, maximum: number) {
  return z.string()
    .regex(/^[1-9][0-9]*$/, 'must be a base-10 positive integer')
    .transform(Number)
    .pipe(z.number().int().min(minimum).max(maximum))
    .default(defaultValue);
}

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    API_HOST: z.string().min(1).default('0.0.0.0'),
    API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
    DATABASE_URL: z.string().min(1),
    CORS_ORIGIN: z.string().min(1).default('http://localhost:3000'),
    TRUST_PROXY_CIDRS: z.string().min(1).transform((value, context) => {
      try {
        return parseTrustedProxyCidrs(value);
      } catch (error) {
        context.addIssue({
          code: 'custom',
          message: error instanceof Error ? error.message : 'must contain valid IP CIDRs'
        });
        return z.NEVER;
      }
    }),
    SESSION_COOKIE_NAME: z.string().min(1).max(64).default('cubic_session'),
    SESSION_COOKIE_SECURE: booleanString,
    SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
    SESSION_IDLE_TIMEOUT_MS: strictPositiveInteger(
      SESSION_DEFAULTS.idleTimeoutMs,
      5 * 60 * 1000,
      30 * 24 * 60 * 60 * 1000
    ),
    SESSION_SOCKET_REVALIDATE_MS: strictPositiveInteger(
      SESSION_DEFAULTS.socketRevalidateMs,
      30 * 1000,
      60 * 60 * 1000
    ),
    REGISTRATION_ENABLED: enabledString,
    MEDIA_ROOT: z.string().min(1).default('/data/media'),
    GROUP_AVATAR_MAX_BYTES: z.coerce.number().int().min(65536).max(8 * 1024 * 1024).default(2 * 1024 * 1024),
    ATTACHMENT_MAX_BYTES: z.coerce.number().int().min(1024 * 1024).max(250 * 1024 * 1024).default(ATTACHMENT_DEFAULTS.maxBytes),
    ATTACHMENT_PENDING_MAX_COUNT: strictPositiveInteger(
      ATTACHMENT_DEFAULTS.pendingMaxCount,
      1,
      1_000
    ),
    ATTACHMENT_PENDING_MAX_BYTES: strictPositiveInteger(
      ATTACHMENT_DEFAULTS.pendingMaxBytes,
      1024 * 1024,
      1024 ** 4
    ),
    ATTACHMENT_MIN_FREE_BYTES: strictPositiveInteger(
      ATTACHMENT_DEFAULTS.minFreeBytes,
      1024 * 1024,
      100 * 1024 ** 4
    ),
    ATTACHMENT_UPLOAD_RATE_LIMIT_MAX: strictPositiveInteger(
      ATTACHMENT_DEFAULTS.uploadRateLimitMax,
      1,
      10_000
    ),
    ATTACHMENT_UPLOAD_RATE_LIMIT_WINDOW_MS: strictPositiveInteger(
      ATTACHMENT_DEFAULTS.uploadRateLimitWindowMs,
      1_000,
      24 * 60 * 60 * 1000
    ),
    ATTACHMENT_CLEANUP_INTERVAL_MS: strictPositiveInteger(
      ATTACHMENT_DEFAULTS.cleanupIntervalMs,
      1_000,
      24 * 60 * 60 * 1000
    ),
    ATTACHMENT_STALE_AGE_MS: strictPositiveInteger(
      ATTACHMENT_DEFAULTS.staleAgeMs,
      60_000,
      365 * 24 * 60 * 60 * 1000
    ),
    ATTACHMENT_CLEANUP_BATCH_SIZE: strictPositiveInteger(
      ATTACHMENT_DEFAULTS.cleanupBatchSize,
      1,
      10_000
    ),
    ATTACHMENT_DELETION_INTERVAL_MS: strictPositiveInteger(
      ATTACHMENT_DEFAULTS.deletionIntervalMs,
      1_000,
      24 * 60 * 60 * 1000
    ),
    ATTACHMENT_DELETION_BATCH_SIZE: strictPositiveInteger(
      ATTACHMENT_DEFAULTS.deletionBatchSize,
      1,
      10_000
    ),
    ATTACHMENT_DELETION_LEASE_MS: strictPositiveInteger(
      ATTACHMENT_DEFAULTS.deletionLeaseMs,
      1_000,
      24 * 60 * 60 * 1000
    ),
    ATTACHMENT_DELETION_RETRY_BASE_MS: strictPositiveInteger(
      ATTACHMENT_DEFAULTS.deletionRetryBaseMs,
      1_000,
      60 * 60 * 1000
    ),
    ATTACHMENT_DELETION_RETRY_MAX_MS: strictPositiveInteger(
      ATTACHMENT_DEFAULTS.deletionRetryMaxMs,
      1_000,
      24 * 60 * 60 * 1000
    ),
    ATTACHMENT_RECONCILIATION_INTERVAL_MS: strictPositiveInteger(
      ATTACHMENT_DEFAULTS.reconciliationIntervalMs,
      60_000,
      7 * 24 * 60 * 60 * 1000
    ),
    ATTACHMENT_ORPHAN_GRACE_MS: strictPositiveInteger(
      ATTACHMENT_DEFAULTS.orphanGraceMs,
      60_000,
      365 * 24 * 60 * 60 * 1000
    ),
    ATTACHMENT_RECONCILIATION_SCAN_BATCH_SIZE: strictPositiveInteger(
      ATTACHMENT_DEFAULTS.reconciliationScanBatchSize,
      1,
      100_000
    ),
    ATTACHMENT_RECONCILIATION_MISSING_BATCH_SIZE: strictPositiveInteger(
      ATTACHMENT_DEFAULTS.reconciliationMissingBatchSize,
      1,
      10_000
    ),
    LIVEKIT_PUBLIC_URL: z.string().min(1),
    LIVEKIT_API_KEY: z.string().min(3),
    LIVEKIT_API_SECRET: z.string().min(32)
  })
  .superRefine((env, context) => {
    if (env.NODE_ENV === 'production' && !env.SESSION_COOKIE_SECURE) {
      context.addIssue({
        code: 'custom',
        path: ['SESSION_COOKIE_SECURE'],
        message: 'must be true when NODE_ENV is production'
      });
    }

    if (env.ATTACHMENT_PENDING_MAX_BYTES < env.ATTACHMENT_MAX_BYTES) {
      context.addIssue({
        code: 'custom',
        path: ['ATTACHMENT_PENDING_MAX_BYTES'],
        message: 'must be at least ATTACHMENT_MAX_BYTES'
      });
    }

    if (env.ATTACHMENT_DELETION_RETRY_MAX_MS < env.ATTACHMENT_DELETION_RETRY_BASE_MS) {
      context.addIssue({
        code: 'custom',
        path: ['ATTACHMENT_DELETION_RETRY_MAX_MS'],
        message: 'must be at least ATTACHMENT_DELETION_RETRY_BASE_MS'
      });
    }

    if (env.SESSION_SOCKET_REVALIDATE_MS > env.SESSION_IDLE_TIMEOUT_MS) {
      context.addIssue({
        code: 'custom',
        path: ['SESSION_SOCKET_REVALIDATE_MS'],
        message: 'must not exceed SESSION_IDLE_TIMEOUT_MS'
      });
    }
  });

export type AppEnv = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  if (source.TRUST_PROXY_HOPS !== undefined) {
    throw new Error(
      'Invalid Cubic API environment: TRUST_PROXY_HOPS has been removed; use TRUST_PROXY_CIDRS with explicit IP CIDRs'
    );
  }

  const result = envSchema.safeParse(source);

  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join('.') || 'environment'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid Cubic API environment: ${details}`);
  }

  return result.data;
}
