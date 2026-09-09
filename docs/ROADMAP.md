# Cubic v2 roadmap

## v2.0.0-alpha.1 — foundation ✅

- TypeScript monorepo
- SvelteKit web app
- Fastify API
- PostgreSQL + Drizzle
- Docker Compose
- health/readiness endpoints
- CI baseline
- architecture and migration documentation

## v2.0.0-alpha.2 — identity & security ✅

- relational users, settings and sessions
- Argon2id password hashing
- login/register/logout/current-user
- server-authoritative identity
- HttpOnly/SameSite session cookies
- revocable PostgreSQL sessions with hashed tokens
- rate limiting
- v1 bcrypt compatibility + transparent Argon2id upgrade
- v1 user/settings import tooling
- protected SvelteKit app shell

The avatar upload implementation was deliberately moved out of alpha.2 so v2 does not reintroduce the v1 MIME-only upload design. It will land with the media/attachment storage boundary.

## v2.0.0-alpha.3 — conversation engine

- `conversations`
- `conversation_members`
- `messages`
- DMs and groups using the same model
- cursor pagination
- Socket.IO authenticated from the server session
- realtime messages and presence
- v1 DM/message migration stage

## v2.0.0-alpha.4 — groups

- create/rename groups
- add/remove members
- owner/admin/member permissions
- invites
- group avatar/storage boundary
- friendship/request migration

## v2.0.0-alpha.5 — voice

- self-hosted LiveKit
- 1:1 calls and group voice rooms
- join/leave lifecycle
- mute/deafen
- device selection
- reconnection handling

## v2.0.0-alpha.6 — screen share & video

- screen share
- camera
- per-participant volume
- call participant UI
- bandwidth-aware defaults

## v2.0.0-beta.1 — messaging UX

- replies
- edit/delete
- reactions
- attachments
- validated media uploads
- typing indicators
- delivered/read receipts

## v2.0.0-beta.2 — discovery & notifications

- full-text message search
- unread state
- pinned messages
- notifications
- PWA baseline

## v2.0.0-beta.3 — hardening & scale

- Redis optional for distributed ephemeral state/rate limits
- load testing
- rate-limit tuning
- reconnection/load-shedding work
- audit logging where appropriate

## v2.0.0-rc.1

- mobile UX pass
- self-hosting documentation
- backup/restore
- migration rehearsal from v1
- security review

## v2.0.0

First stable Cubic v2 release.
