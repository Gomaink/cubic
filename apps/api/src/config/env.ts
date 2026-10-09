import { z } from 'zod';
import { parseTrustedProxyCidrs } from './proxy.js';
import { canonicalBrowserOrigin } from '../security/browser-request.js';

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

export const LIVEKIT_AUTHORIZATION_DEFAULTS = {
  reconciliationIntervalMs: 30 * 1_000
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
    CORS_ORIGIN: z.string().transform((value, context) => {
      try {
        return canonicalBrowserOrigin(value);
      } catch (error) {
        context.addIssue({
          code: 'custom',
          message: error instanceof Error ? error.message : 'must be one exact HTTP or HTTPS origin'
        });
        return z.NEVER;
      }
    }),
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
    MAIL_TRANSPORT: z.enum(['disabled', 'smtp']).default('disabled'),
    MAIL_FROM: z.string().default(''),
    SMTP_HOST: z.string().default(''),
    SMTP_PORT: z.string().default(''),
    SMTP_SECURE: booleanString,
    SMTP_USER: z.string().default(''),
    SMTP_PASSWORD: z.string().default(''),
    PUBLIC_APP_URL: z.string().default(''),
    WEBAUTHN_RP_ID: z.string().default(''),
    WEBAUTHN_RP_NAME: z.string().trim().min(1).max(64).default('Cubic'),
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
    LIVEKIT_API_URL: z.string().url().refine((value) => {
      const protocol = new URL(value).protocol;
      return protocol === 'http:' || protocol === 'https:';
    }, 'must use http or https'),
    LIVEKIT_AUTHORIZATION_RECONCILE_MS: strictPositiveInteger(
      LIVEKIT_AUTHORIZATION_DEFAULTS.reconciliationIntervalMs,
      5_000,
      5 * 60 * 1_000
    ),
    LIVEKIT_API_KEY: z.string().min(3),
    LIVEKIT_API_SECRET: z.string().min(32),
    INVITE_LINK_ACTIVE_KEY_ID: z.string().optional(),
    INVITE_LINK_HMAC_KEYS: z.string().optional()
  })
  .superRefine((env, context) => {
    if (env.NODE_ENV === 'production' && (!env.INVITE_LINK_ACTIVE_KEY_ID || !env.INVITE_LINK_HMAC_KEYS)) {
      context.addIssue({ code: 'custom', path: ['INVITE_LINK_HMAC_KEYS'], message: 'persistent invite link HMAC keys and active key ID are required' });
    }
    if (env.WEBAUTHN_RP_ID && env.WEBAUTHN_RP_ID !== new URL(env.CORS_ORIGIN).hostname) {
      context.addIssue({ code: 'custom', path: ['WEBAUTHN_RP_ID'], message: 'must exactly match the configured CORS_ORIGIN hostname' });
    }
    if (env.MAIL_TRANSPORT === 'smtp') {
      if (!z.email().safeParse(env.MAIL_FROM).success) context.addIssue({ code: 'custom', path: ['MAIL_FROM'], message: 'must be a valid sender email in SMTP mode' });
      if (!env.SMTP_HOST.trim()) context.addIssue({ code: 'custom', path: ['SMTP_HOST'], message: 'is required in SMTP mode' });
      if (!/^[1-9][0-9]*$/.test(env.SMTP_PORT) || Number(env.SMTP_PORT) > 65535) context.addIssue({ code: 'custom', path: ['SMTP_PORT'], message: 'must be a TCP port in SMTP mode' });
      if (Boolean(env.SMTP_USER) !== Boolean(env.SMTP_PASSWORD)) context.addIssue({ code: 'custom', path: ['SMTP_USER'], message: 'SMTP_USER and SMTP_PASSWORD must be supplied together' });
      try {
        const publicOrigin = canonicalBrowserOrigin(env.PUBLIC_APP_URL);
        if (env.NODE_ENV === 'production' && !publicOrigin.startsWith('https://')) throw new Error('HTTPS required');
      } catch {
        context.addIssue({ code: 'custom', path: ['PUBLIC_APP_URL'], message: 'must be one exact HTTPS origin in production (HTTP is allowed for local development)' });
      }
    }
    if (env.NODE_ENV === 'production' && !env.CORS_ORIGIN.startsWith('https://')) {
      context.addIssue({
        code: 'custom',
        path: ['CORS_ORIGIN'],
        message: 'must use https when NODE_ENV is production'
      });
    }

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
  if (source.MAIL_TRANSPORT === 'smtp' && source.SMTP_SECURE === undefined) {
    throw new Error('Invalid Cubic API environment: SMTP_SECURE: is required in SMTP mode');
  }
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

  return { ...result.data, WEBAUTHN_RP_ID: result.data.WEBAUTHN_RP_ID || new URL(result.data.CORS_ORIGIN).hostname };
}
