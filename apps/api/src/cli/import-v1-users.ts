import { readFile } from 'node:fs/promises';
import { eq } from 'drizzle-orm';
import { createDatabase } from '@cubic/database';
import { userSettings, users } from '@cubic/database/schema';
import { normalizeEmail, normalizeUsername } from '../auth/identity.js';

interface LegacyUser {
  _id?: unknown;
  email?: unknown;
  username?: unknown;
  nickname?: unknown;
  password?: unknown;
  avatarUrl?: unknown;
}

interface LegacyConfig {
  userId?: unknown;
  inputVolume?: unknown;
  outputVolume?: unknown;
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function objectId(value: unknown): string | null {
  if (typeof value === 'string' && value.length > 0) return value;
  if (value && typeof value === 'object' && '$oid' in value) {
    const oid = (value as { $oid?: unknown }).$oid;
    return typeof oid === 'string' ? oid : null;
  }
  return null;
}

function numberInRange(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(100, Math.round(value)));
}

async function readRecords<T>(path: string): Promise<T[]> {
  const source = (await readFile(path, 'utf8')).trim();
  if (!source) return [];

  if (source.startsWith('[')) return JSON.parse(source) as T[];

  return source
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

const usersPath = argument('--users');
const configsPath = argument('--configs');

if (!usersPath) {
  console.error('Usage: npm run import:v1-users -- --users users.json [--configs userconfigs.json]');
  process.exit(1);
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is required.');
  process.exit(1);
}

const legacyUsers = await readRecords<LegacyUser>(usersPath);
const legacyConfigs = configsPath ? await readRecords<LegacyConfig>(configsPath) : [];
const configByUserId = new Map<string, LegacyConfig>();

for (const config of legacyConfigs) {
  const id = objectId(config.userId);
  if (id) configByUserId.set(id, config);
}

const database = createDatabase(databaseUrl);
let imported = 0;
let skipped = 0;

try {
  for (const legacy of legacyUsers) {
    const legacyId = objectId(legacy._id);
    const email = typeof legacy.email === 'string' ? legacy.email.trim() : '';
    const username = typeof legacy.username === 'string' ? legacy.username.trim() : '';
    const displayName =
      typeof legacy.nickname === 'string' && legacy.nickname.trim()
        ? legacy.nickname.trim()
        : username;
    const passwordHash = typeof legacy.password === 'string' ? legacy.password : '';

    if (!legacyId || !email || !username || !displayName || !passwordHash.startsWith('$2')) {
      console.warn(`Skipping malformed v1 user ${legacyId ?? '<unknown>'}.`);
      skipped += 1;
      continue;
    }

    const existing = await database.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.legacyId, legacyId))
      .limit(1);

    if (existing[0]) {
      console.info(`Skipping already imported v1 user ${legacyId}.`);
      skipped += 1;
      continue;
    }

    const config = configByUserId.get(legacyId);

    try {
      await database.db.transaction(async (tx) => {
        const inserted = await tx
          .insert(users)
          .values({
            legacyId,
            email,
            emailNormalized: normalizeEmail(email),
            username: normalizeUsername(username),
            usernameNormalized: normalizeUsername(username),
            displayName: displayName.slice(0, 64),
            passwordHash,
            avatarUrl: typeof legacy.avatarUrl === 'string' ? legacy.avatarUrl : null
          })
          .returning({ id: users.id });

        const created = inserted[0];
        if (!created) throw new Error('Imported user insert returned no row.');

        await tx.insert(userSettings).values({
          userId: created.id,
          inputVolume: numberInRange(config?.inputVolume, 100),
          outputVolume: numberInRange(config?.outputVolume, 100)
        });
      });

      imported += 1;
      console.info(`Imported @${normalizeUsername(username)} (${legacyId}).`);
    } catch (error) {
      console.warn(`Could not import ${legacyId}; likely an e-mail/username conflict.`, error);
      skipped += 1;
    }
  }
} finally {
  await database.pool.end();
}

console.info(`Cubic v1 user import complete: ${imported} imported, ${skipped} skipped.`);
