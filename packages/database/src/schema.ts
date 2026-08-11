import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * Alpha.1 intentionally keeps the application schema minimal.
 * Users, sessions, conversations and messages are introduced in later alphas.
 * This table proves the migration pipeline and stores schema/application metadata.
 */
export const cubicMeta = pgTable('cubic_meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow()
});
