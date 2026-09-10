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

type MessageCreatedListener = (event: MessageCreatedEvent) => void;
type ConversationOpenedListener = (event: ConversationOpenedEvent) => void;

export interface RealtimeEvents {
  emitMessageCreated(event: MessageCreatedEvent): void;
  emitConversationOpened(event: ConversationOpenedEvent): void;
  onMessageCreated(listener: MessageCreatedListener): () => void;
  onConversationOpened(listener: ConversationOpenedListener): () => void;
}

export function createRealtimeEvents(): RealtimeEvents {
  const messageCreatedListeners = new Set<MessageCreatedListener>();
  const conversationOpenedListeners = new Set<ConversationOpenedListener>();

  return {
    emitMessageCreated(event) {
      for (const listener of messageCreatedListeners) listener(event);
    },
    emitConversationOpened(event) {
      for (const listener of conversationOpenedListeners) listener(event);
    },
    onMessageCreated(listener) {
      messageCreatedListeners.add(listener);
      return () => messageCreatedListeners.delete(listener);
    },
    onConversationOpened(listener) {
      conversationOpenedListeners.add(listener);
      return () => conversationOpenedListeners.delete(listener);
    }
  };
}
