# Cubic v2.0.0-alpha.3 — Conversation Engine

Alpha.3 turns the identity foundation into the first usable messenger slice.

## Included
- user search by username/display name
- friend requests, accept/decline/cancel, friends and blocks
- server-authoritative direct conversation creation
- one canonical DM per pair of users
- conversation membership authorization
- idempotent message writes with client_message_id
- cursor-ready message pagination
- last-message conversation ordering
- responsive Svelte messenger UI for People, DMs and messages
- authenticated Socket.IO realtime delivery with conversation rooms and automatic reconnect/resynchronization

- same-origin WebSocket proxy through the web container; the API remains private on the Docker network
- mobile conversation layout with functional back navigation, composer and empty state
- iOS/Chrome tab-resume recovery and scoped viewport/scroll handling
- UUID v4 fallback for local HTTP browsers where `crypto.randomUUID()` is unavailable
- JSON Content-Type is only sent when a request actually has a body

## Security invariants
- sender identity always comes from the authenticated session
- users cannot read or write conversations they are not members of
- direct messages require an accepted friendship in alpha.3
- either-direction blocks prevent new messages and remove friendships
- duplicate client retries do not duplicate stored messages
