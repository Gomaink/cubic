# Cubic v2.0.0-alpha.3 — Test Plan

## Social graph

1. User A searches for User B.
2. User A sends a friend request.
3. User B sees the incoming request.
4. User B accepts it.
5. Both users appear as friends.
6. Decline and cancel actions work without creating friendships.

## Direct conversations

1. A friend can open a direct conversation.
2. Opening the same DM again reuses the existing conversation.
3. Both users are conversation members.
4. A non-member cannot read or write the conversation.

## Messages

1. User A sends a message to User B.
2. User B receives it immediately.
3. User B can reply.
4. Messages remain after reload.
5. `clientMessageId` prevents duplicate persistence.
6. Message timestamps come from the server.

## Realtime

1. Two devices can remain connected simultaneously.
2. Messages arrive instantly without periodic polling.
3. Socket.IO authenticates using the existing Cubic session.
4. Connections only join rooms the authenticated user is allowed to access.
5. Reconnecting does not duplicate messages.

## Mobile / iOS

1. Conversation list scrolls normally.
2. Chat message area scrolls independently.
3. Back button returns to Conversations.
4. Composer stays visible.
5. Empty conversations display an empty state.
6. Landing, login and register remain vertically scrollable.
7. Leaving Chrome/Safari and returning keeps the UI responsive.
8. Realtime reconnects/resynchronizes after the tab resumes.
9. Local HTTP works even when `crypto.randomUUID()` is unavailable.

## Regression checklist added during alpha.3 hardening

11. Accept/decline/cancel social actions must not send `Content-Type: application/json` with an empty body.
12. Opening a DM twice for the same pair must reuse the same canonical conversation.
13. Sending the same `clientMessageId` twice must persist only one message.
14. A non-member must not be able to read or write another conversation.
15. Leave the app in the background on iOS/Chrome, return to it and verify the UI remains interactive.
16. After returning from the background, realtime must reconnect/resynchronize without reopening the tab.
17. The public landing/login/register pages must remain vertically scrollable on mobile.
18. The messenger must keep its own constrained viewport; only the conversation/message regions should scroll.
19. Local HTTP access must still generate valid UUID v4 client message IDs when `crypto.randomUUID()` is unavailable.
20. With two devices open, messages must arrive instantly without periodic GET polling.
