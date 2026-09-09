# Cubic v2 architecture

## Principles

1. **Conversation-centric data.** A DM and a group are both conversations with members.
2. **Server-authoritative identity.** Clients never choose who they are by sending a `senderId`.
3. **Separate text realtime from media realtime.** Messaging/presence and WebRTC media solve different problems.
4. **Modular monolith first.** Keep deployment simple for self-hosters; split services only when scale justifies it.
5. **Durable auth state in PostgreSQL.** Sessions are revocable and do not depend on process memory.
6. **Stateless app processes where practical.** Ephemeral distributed state can move to Redis later.
7. **TLS terminates at the reverse proxy.** Cubic serves plain HTTP inside the trusted container network.

## Alpha.2 runtime

```text
Browser
   |
   | same-origin /api/*
   v
SvelteKit web :3000
   |            \
   |             `-- protected SSR -> auth/me
   v
Fastify API :3001
   |
   +-- Argon2id
   +-- rate limits
   +-- session resolver
   |
   v
PostgreSQL 18
  users
  user_settings
  sessions
```

The SvelteKit proxy deliberately keeps API calls same-origin in the browser. The API remains independently reachable for health checks and future native/API clients.

## Session lifecycle

```text
register/login
   -> verify/hash password
   -> generate random token
   -> store SHA-256(token) in sessions
   -> Set-Cookie(HttpOnly, SameSite=Lax)

protected request
   -> cookie token
   -> SHA-256(token)
   -> sessions JOIN users
   -> request.auth.user
```

## Planned realtime/media runtime

```text
Browser
  |-- HTTPS / WebSocket --> Cubic API (messages, typing, presence, permissions)
  |
  `-- WebRTC -----------> LiveKit SFU (voice, camera, screen share)
                              |
                              `-- TURN / ICE path
```

## Core data model progression

```text
alpha.2:
users
user_settings
sessions

alpha.3+:
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
