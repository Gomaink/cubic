import { z } from 'zod';

const booleanString = z.enum(['true', 'false']).default('false').transform((value) => value === 'true');
const enabledString = z.enum(['true', 'false']).default('true').transform((value) => value === 'true');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_HOST: z.string().min(1).default('0.0.0.0'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  DATABASE_URL: z.string().min(1),
  CORS_ORIGIN: z.string().min(1).default('http://localhost:3000'),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(8).default(1),
  SESSION_COOKIE_NAME: z.string().min(1).max(64).default('cubic_session'),
  SESSION_COOKIE_SECURE: booleanString,
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  REGISTRATION_ENABLED: enabledString,
  MEDIA_ROOT: z.string().min(1).default('/data/media'),
  GROUP_AVATAR_MAX_BYTES: z.coerce.number().int().min(65536).max(8 * 1024 * 1024).default(2 * 1024 * 1024)
});

export type AppEnv = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  const result = envSchema.safeParse(source);

  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join('.') || 'environment'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid Cubic API environment: ${details}`);
  }

  return result.data;
}
