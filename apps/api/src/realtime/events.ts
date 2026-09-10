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
}

export interface MessageCreatedEvent {
  conversationId: string;
  message: RealtimeMessage;
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
type ConversationOpenedListener = (event: ConversationOpenedEvent) => void;
type ConversationChangedListener = (event: ConversationChangedEvent) => void;
type ConversationRemovedListener = (event: ConversationRemovedEvent) => void;
type GroupInvitesChangedListener = (event: GroupInvitesChangedEvent) => void;

export interface RealtimeEvents {
  emitMessageCreated(event: MessageCreatedEvent): void;
  emitConversationOpened(event: ConversationOpenedEvent): void;
  emitConversationChanged(event: ConversationChangedEvent): void;
  emitConversationRemoved(event: ConversationRemovedEvent): void;
  emitGroupInvitesChanged(event: GroupInvitesChangedEvent): void;
  onMessageCreated(listener: MessageCreatedListener): () => void;
  onConversationOpened(listener: ConversationOpenedListener): () => void;
  onConversationChanged(listener: ConversationChangedListener): () => void;
  onConversationRemoved(listener: ConversationRemovedListener): () => void;
  onGroupInvitesChanged(listener: GroupInvitesChangedListener): () => void;
}

export function createRealtimeEvents(): RealtimeEvents {
  const messageCreatedListeners = new Set<MessageCreatedListener>();
  const conversationOpenedListeners = new Set<ConversationOpenedListener>();
  const conversationChangedListeners = new Set<ConversationChangedListener>();
  const conversationRemovedListeners = new Set<ConversationRemovedListener>();
  const groupInvitesChangedListeners = new Set<GroupInvitesChangedListener>();

  return {
    emitMessageCreated(event) {
      for (const listener of messageCreatedListeners) listener(event);
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
