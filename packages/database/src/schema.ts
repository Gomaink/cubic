import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar
} from 'drizzle-orm/pg-core';

export const cubicMeta = pgTable('cubic_meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow()
});

/**
 * Account identity is deliberately server-authoritative. The browser never gets
 * to decide which user id is associated with a write operation.
 */
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    legacyId: text('legacy_id'),
    email: text('email').notNull(),
    emailNormalized: text('email_normalized').notNull(),
    username: varchar('username', { length: 32 }).notNull(),
    usernameNormalized: varchar('username_normalized', { length: 32 }).notNull(),
    displayName: varchar('display_name', { length: 64 }).notNull(),
    passwordHash: text('password_hash').notNull(),
    avatarUrl: text('avatar_url'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true, mode: 'date' }),
    disabledAt: timestamp('disabled_at', { withTimezone: true, mode: 'date' })
  },
  (table) => [
    uniqueIndex('users_legacy_id_uq').on(table.legacyId),
    uniqueIndex('users_email_normalized_uq').on(table.emailNormalized),
    uniqueIndex('users_username_normalized_uq').on(table.usernameNormalized)
  ]
);

export const userSettings = pgTable('user_settings', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  theme: varchar('theme', { length: 16 }).notNull().default('dark'),
  compactMode: boolean('compact_mode').notNull().default(false),
  reduceMotion: boolean('reduce_motion').notNull().default(false),
  inputVolume: integer('input_volume').notNull().default(100),
  outputVolume: integer('output_volume').notNull().default(100),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow()
});

/**
 * Session cookies contain a random token. Only a SHA-256 digest of that token
 * is persisted, so a database leak does not immediately expose live cookies.
 */
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull()
  },
  (table) => [
    uniqueIndex('sessions_token_hash_uq').on(table.tokenHash),
    index('sessions_user_id_idx').on(table.userId),
    index('sessions_expires_at_idx').on(table.expiresAt)
  ]
);
