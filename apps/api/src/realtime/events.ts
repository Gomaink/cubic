export interface RealtimeAttachment {
  id: string;
  conversationId: string;
  messageId: string | null;
  originalName: string;
  contentType: string;
  kind: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  createdAt: string;
  url: string;
}

export interface RealtimeReplyPreview {
  id: string;
  senderId: string;
  senderUsername: string;
  senderDisplayName: string;
  body: string;
  deletedAt: string | null;
  attachmentKind: 'image' | 'video' | 'file' | null;
}

export interface RealtimeReaction {
  reaction: string;
  count: number;
  reactedByCurrentUser: boolean;
}

export interface RealtimeReactionCount {
  reaction: string;
  count: number;
}

export interface RealtimeMessage {
  id: string;
  conversationId: string;
  senderId: string;
  clientMessageId: string;
  body: string;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
  senderUsername?: string;
  senderDisplayName?: string;
  senderAvatarUrl?: string | null;
  attachments: RealtimeAttachment[];
  replyTo: RealtimeReplyPreview | null;
  reactions: RealtimeReaction[];
}

export interface MessageCreatedEvent {
  conversationId: string;
  message: RealtimeMessage;
}

export interface MessageChangedEvent {
  conversationId: string;
  message: RealtimeMessage;
}

export interface MessageReactionsChangedEvent {
  conversationId: string;
  messageId: string;
  userId: string;
  reaction: string;
  active: boolean;
  reactions: RealtimeReactionCount[];
}

export interface ConversationOpenedEvent {
  conversationId: string;
  userIds: string[];
}

export interface ConversationChangedEvent {
  conversationId: string;
  userIds: string[];
}

export interface ConversationRemovedEvent {
  conversationId: string;
  removedUserIds: string[];
  remainingUserIds: string[];
}

export interface GroupInvitesChangedEvent {
  userIds: string[];
}

type MessageCreatedListener = (event: MessageCreatedEvent) => void;
type MessageUpdatedListener = (event: MessageChangedEvent) => void;
type MessageDeletedListener = (event: MessageChangedEvent) => void;
type MessageReactionsChangedListener = (event: MessageReactionsChangedEvent) => void;
type ConversationOpenedListener = (event: ConversationOpenedEvent) => void;
type ConversationChangedListener = (event: ConversationChangedEvent) => void;
type ConversationRemovedListener = (event: ConversationRemovedEvent) => void;
type GroupInvitesChangedListener = (event: GroupInvitesChangedEvent) => void;

export interface RealtimeEvents {
  emitMessageCreated(event: MessageCreatedEvent): void;
  emitMessageUpdated(event: MessageChangedEvent): void;
  emitMessageDeleted(event: MessageChangedEvent): void;
  emitMessageReactionsChanged(event: MessageReactionsChangedEvent): void;
  emitConversationOpened(event: ConversationOpenedEvent): void;
  emitConversationChanged(event: ConversationChangedEvent): void;
  emitConversationRemoved(event: ConversationRemovedEvent): void;
  emitGroupInvitesChanged(event: GroupInvitesChangedEvent): void;
  onMessageCreated(listener: MessageCreatedListener): () => void;
  onMessageUpdated(listener: MessageUpdatedListener): () => void;
  onMessageDeleted(listener: MessageDeletedListener): () => void;
  onMessageReactionsChanged(listener: MessageReactionsChangedListener): () => void;
  onConversationOpened(listener: ConversationOpenedListener): () => void;
  onConversationChanged(listener: ConversationChangedListener): () => void;
  onConversationRemoved(listener: ConversationRemovedListener): () => void;
  onGroupInvitesChanged(listener: GroupInvitesChangedListener): () => void;
}

export function createRealtimeEvents(): RealtimeEvents {
  const messageCreatedListeners = new Set<MessageCreatedListener>();
  const messageUpdatedListeners = new Set<MessageUpdatedListener>();
  const messageDeletedListeners = new Set<MessageDeletedListener>();
  const messageReactionsChangedListeners = new Set<MessageReactionsChangedListener>();
  const conversationOpenedListeners = new Set<ConversationOpenedListener>();
  const conversationChangedListeners = new Set<ConversationChangedListener>();
  const conversationRemovedListeners = new Set<ConversationRemovedListener>();
  const groupInvitesChangedListeners = new Set<GroupInvitesChangedListener>();

  return {
    emitMessageCreated(event) {
      for (const listener of messageCreatedListeners) listener(event);
    },
    emitMessageUpdated(event) {
      for (const listener of messageUpdatedListeners) listener(event);
    },
    emitMessageDeleted(event) {
      for (const listener of messageDeletedListeners) listener(event);
    },
    emitMessageReactionsChanged(event) {
      for (const listener of messageReactionsChangedListeners) listener(event);
    },
    emitConversationOpened(event) {
      for (const listener of conversationOpenedListeners) listener(event);
    },
    emitConversationChanged(event) {
      for (const listener of conversationChangedListeners) listener(event);
    },
    emitConversationRemoved(event) {
      for (const listener of conversationRemovedListeners) listener(event);
    },
    emitGroupInvitesChanged(event) {
      for (const listener of groupInvitesChangedListeners) listener(event);
    },
    onMessageCreated(listener) {
      messageCreatedListeners.add(listener);
      return () => messageCreatedListeners.delete(listener);
    },
    onMessageUpdated(listener) {
      messageUpdatedListeners.add(listener);
      return () => messageUpdatedListeners.delete(listener);
    },
    onMessageDeleted(listener) {
      messageDeletedListeners.add(listener);
      return () => messageDeletedListeners.delete(listener);
    },
    onMessageReactionsChanged(listener) {
      messageReactionsChangedListeners.add(listener);
      return () => messageReactionsChangedListeners.delete(listener);
    },
    onConversationOpened(listener) {
      conversationOpenedListeners.add(listener);
      return () => conversationOpenedListeners.delete(listener);
    },
    onConversationChanged(listener) {
      conversationChangedListeners.add(listener);
      return () => conversationChangedListeners.delete(listener);
    },
    onConversationRemoved(listener) {
      conversationRemovedListeners.add(listener);
      return () => conversationRemovedListeners.delete(listener);
    },
    onGroupInvitesChanged(listener) {
      groupInvitesChangedListeners.add(listener);
      return () => groupInvitesChangedListeners.delete(listener);
    }
  };
}
