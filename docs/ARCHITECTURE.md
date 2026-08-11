# Cubic v2 architecture

## Principles

1. **Conversation-centric data.** A DM and a group are both conversations with members.
2. **Server-authoritative identity.** Clients never choose who they are by sending a `senderId`.
3. **Separate text realtime from media realtime.** Messaging/presence and WebRTC media solve different problems.
4. **Modular monolith first.** Keep deployment simple for self-hosters; split services only when scale justifies it.
5. **Stateless app processes where practical.** Durable state belongs in PostgreSQL; ephemeral distributed state can move to Redis later.
6. **TLS terminates at the reverse proxy.** Cubic itself serves plain HTTP inside the trusted container network.

## Alpha.1 runtime

```text
Browser
   |
   v
SvelteKit web :3000
   |
   v
Fastify API :3001
   |
   v
PostgreSQL 18
```

## Planned realtime/media runtime

```text
Browser
  |-- HTTPS / WebSocket --> Cubic API (messages, typing, presence, permissions)
  |
  `-- WebRTC -----------> LiveKit SFU (voice, camera, screen share)
                              |
                              `-- integrated TURN / ICE path
```

## Planned core data model

```text
users
sessions
friendships
friend_requests
blocks
conversations
conversation_members
messages
message_reactions
message_receipts
attachments
calls
call_participants
```

The exact schema begins in alpha.2 and alpha.3. Alpha.1 contains only `cubic_meta` so the database package and migration workflow can be validated without prematurely freezing product-domain tables.
