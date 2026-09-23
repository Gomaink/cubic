# Cubic v2 architecture

## Principles

1. **Reusable message containers.** DMs and legacy groups are conversations with members; server text channels use conversations for messages but derive access from server membership.
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

Forwarded identity crosses two explicit checks. The web proxy accepts edge
forwarding only from operator-configured CIDRs and replaces incoming forwarding
headers with canonical client IP, protocol and host values. Fastify accepts
those values only when the web peer is in the same configured trust boundary.
Neither layer supports numeric hop trust.

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


## Alpha.3 realtime runtime

```text
Browser
  |
  | HTTP /api/*
  | WebSocket /socket.io
  v
Cubic web container
  |-- SvelteKit HTTP handling
  `-- same-origin WebSocket proxy
           |
           v
       Cubic API
       |-- authenticated session resolution
       |-- Socket.IO conversation rooms
       |-- server-authoritative message writes
       `-- PostgreSQL
```

The API is not published on a host port in the production Compose topology. Browser HTTP and WebSocket traffic enters through the web service and reaches the API on the private Docker network. Socket connections resolve the existing Cubic session cookie and only join rooms for conversations the authenticated user belongs to.

On mobile browser resume (`pageshow`, focus, visibility and online transitions), the client reconnects when necessary and refreshes social/conversation state plus the active history to close any suspension gap.

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

Alpha 9 Slice 1 adds independent `servers` and `server_members` records for
server identity and membership. Existing direct and group conversations remain
unchanged; a server is not a conversation. Slice 2 adds `server_text_channels`:
each channel belongs to a server and uniquely references a `server_text`
conversation as its message, reaction and attachment container. Current
`server_members` membership grants channel access; members are not copied into
`conversation_members`. Existing DM/group authority remains separate. Text
channels reuse conversation realtime rooms and have no call/LiveKit capability.
