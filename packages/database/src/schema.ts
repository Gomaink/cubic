import {
  type AnyPgColumn,
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
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow()
});

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
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
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
  userId: uuid('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  theme: varchar('theme', { length: 16 }).notNull().default('dark'),
  compactMode: boolean('compact_mode').notNull().default(false),
  reduceMotion: boolean('reduce_motion').notNull().default(false),
  inputVolume: integer('input_volume').notNull().default(100),
  outputVolume: integer('output_volume').notNull().default(100),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow()
});

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull()
  },
  (table) => [
    uniqueIndex('sessions_token_hash_uq').on(table.tokenHash),
    index('sessions_user_id_idx').on(table.userId),
    index('sessions_expires_at_idx').on(table.expiresAt)
  ]
);

export const friendRequests = pgTable(
  'friend_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    senderId: uuid('sender_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    receiverId: uuid('receiver_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    status: varchar('status', { length: 16 }).notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    respondedAt: timestamp('responded_at', { withTimezone: true, mode: 'date' })
  },
  (table) => [
    uniqueIndex('friend_requests_pair_uq').on(table.senderId, table.receiverId),
    index('friend_requests_receiver_status_idx').on(table.receiverId, table.status),
    index('friend_requests_sender_status_idx').on(table.senderId, table.status)
  ]
);

export const friendships = pgTable(
  'friendships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userLowId: uuid('user_low_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    userHighId: uuid('user_high_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex('friendships_pair_uq').on(table.userLowId, table.userHighId),
    index('friendships_low_idx').on(table.userLowId),
    index('friendships_high_idx').on(table.userHighId)
  ]
);

export const blocks = pgTable(
  'blocks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    blockerId: uuid('blocker_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    blockedId: uuid('blocked_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex('blocks_pair_uq').on(table.blockerId, table.blockedId),
    index('blocks_blocker_idx').on(table.blockerId),
    index('blocks_blocked_idx').on(table.blockedId)
  ]
);

export const conversations = pgTable(
  'conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: varchar('kind', { length: 16 }).notNull().default('direct'),
    title: varchar('title', { length: 96 }),
    avatarKey: text('avatar_key'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow()
  },
  (table) => [index('conversations_updated_at_idx').on(table.updatedAt)]
);

export const conversationMembers = pgTable(
  'conversation_members',
  {
    conversationId: uuid('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    role: varchar('role', { length: 16 }).notNull().default('member'),
    joinedAt: timestamp('joined_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex('conversation_members_pair_uq').on(table.conversationId, table.userId),
    index('conversation_members_user_idx').on(table.userId)
  ]
);

export const directConversationPairs = pgTable(
  'direct_conversation_pairs',
  {
    conversationId: uuid('conversation_id').primaryKey().references(() => conversations.id, { onDelete: 'cascade' }),
    userLowId: uuid('user_low_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    userHighId: uuid('user_high_id').notNull().references(() => users.id, { onDelete: 'cascade' })
  },
  (table) => [uniqueIndex('direct_conversation_pairs_pair_uq').on(table.userLowId, table.userHighId)]
);

export const groupInvites = pgTable(
  'group_invites',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
    inviterId: uuid('inviter_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    inviteeId: uuid('invitee_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    status: varchar('status', { length: 16 }).notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    respondedAt: timestamp('responded_at', { withTimezone: true, mode: 'date' })
  },
  (table) => [
    uniqueIndex('group_invites_conversation_invitee_uq').on(table.conversationId, table.inviteeId),
    index('group_invites_invitee_status_idx').on(table.inviteeId, table.status),
    index('group_invites_conversation_status_idx').on(table.conversationId, table.status)
  ]
);

export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
    senderId: uuid('sender_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
    clientMessageId: uuid('client_message_id').notNull(),
    replyToMessageId: uuid('reply_to_message_id').references(
      (): AnyPgColumn => messages.id,
      { onDelete: 'set null' }
    ),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    editedAt: timestamp('edited_at', { withTimezone: true, mode: 'date' }),
    deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'date' })
  },
  (table) => [
    uniqueIndex('messages_sender_client_uq').on(table.senderId, table.clientMessageId),
    index('messages_conversation_created_idx').on(table.conversationId, table.createdAt),
    index('messages_sender_idx').on(table.senderId),
    index('messages_reply_to_idx').on(table.replyToMessageId)
  ]
);


export const attachments = pgTable(
  'attachments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    uploaderId: uuid('uploader_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    messageId: uuid('message_id')
      .references(() => messages.id, { onDelete: 'cascade' }),
    storageKey: text('storage_key').notNull(),
    originalName: text('original_name').notNull(),
    contentType: varchar('content_type', { length: 160 }).notNull(),
    kind: varchar('kind', { length: 16 }).notNull().default('file'),
    sizeBytes: integer('size_bytes').notNull(),
    width: integer('width'),
    height: integer('height'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    attachedAt: timestamp('attached_at', { withTimezone: true, mode: 'date' })
  },
  (table) => [
    uniqueIndex('attachments_storage_key_uq').on(table.storageKey),
    index('attachments_message_idx').on(table.messageId),
    index('attachments_conversation_created_idx')
      .on(table.conversationId, table.createdAt),
    index('attachments_pending_uploader_idx')
      .on(table.uploaderId, table.createdAt)
  ]
);

export const messageReactions = pgTable(
  'message_reactions',
  {
    messageId: uuid('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    reaction: varchar('reaction', { length: 16 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow()
  },
  (table) => [
    uniqueIndex('message_reactions_message_user_reaction_uq')
      .on(table.messageId, table.userId, table.reaction),
    index('message_reactions_message_idx').on(table.messageId),
    index('message_reactions_user_idx').on(table.userId)
  ]
);

export const calls = pgTable(
  'calls',
  {
    id: uuid('id').primaryKey(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    kind: varchar('kind', { length: 16 }).notNull().default('direct'),
    initiatedBy: uuid('initiated_by').references(() => users.id, { onDelete: 'set null' }),
    status: varchar('status', { length: 16 }).notNull().default('ringing'),
    startedAt: timestamp('started_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    answeredAt: timestamp('answered_at', { withTimezone: true, mode: 'date' }),
    endedAt: timestamp('ended_at', { withTimezone: true, mode: 'date' }),
    endedBy: uuid('ended_by').references(() => users.id, { onDelete: 'set null' })
  },
  (table) => [
    index('calls_conversation_started_idx').on(table.conversationId, table.startedAt),
    index('calls_initiated_by_started_idx').on(table.initiatedBy, table.startedAt),
    index('calls_status_idx').on(table.status)
  ]
);

export const callParticipants = pgTable(
  'call_participants',
  {
    callId: uuid('call_id')
      .notNull()
      .references(() => calls.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: varchar('role', { length: 16 }).notNull().default('member'),
    invitedAt: timestamp('invited_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    joinedAt: timestamp('joined_at', { withTimezone: true, mode: 'date' }),
    leftAt: timestamp('left_at', { withTimezone: true, mode: 'date' })
  },
  (table) => [
    uniqueIndex('call_participants_call_user_uq').on(table.callId, table.userId),
    index('call_participants_user_idx').on(table.userId),
    index('call_participants_call_idx').on(table.callId)
  ]
);
