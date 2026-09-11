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

## v2.0.0-alpha.3 — conversation engine ✅

- `conversations`
- `conversation_members`
- `messages`
- DMs and groups using the same model
- cursor pagination
- Socket.IO authenticated from the server session
- realtime messages via authenticated Socket.IO
- presence refinement remains deferred until multi-device semantics are finalized
- v1 DM/message migration stage

Alpha.3 validated end to end on the self-hosted Docker deployment: social graph, canonical DMs, durable messages, session-authenticated realtime delivery and mobile resume/reconnect behavior.

## v2.0.0-alpha.4 — groups 🚧

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

### Alpha.4 hardening status
Group invitations, group avatar storage boundary and transaction-scoped membership locking are implemented in the alpha.4 worktree. The next checkpoint is migration `0002`, functional invite/avatar testing and then alpha.4 closeout.

### Alpha.4 completed

Alpha.4 is functionally complete and validated. The next milestone is alpha.5, focused on realtime voice using self-hosted LiveKit/WebRTC, while keeping the existing Cubic identity, conversation membership and permission model as the authorization boundary.

### Alpha.5 voice core status

The first alpha.5 slice introduces self-hosted LiveKit voice for direct and group conversations. After LAN/HTTPS validation, remaining alpha.5 work is ringing/call lifecycle, TURN/fallback hardening and voice UX polish before camera/screen sharing.

### Alpha.5 ringing/call lifecycle status

Voice transport is validated and DM ringing/call lifecycle is now implemented. Remaining alpha.5 work is hardening around long-lived/disconnected calls, TURN/fallback deployment, and final voice UX regression testing before alpha.5 closeout.

### Alpha.5 history/deafen status

Message history pagination UX, jump-to-latest behavior, Deafen, and a second Onyx UI refinement are implemented. The next alpha.5 checkpoint is long-lived voice/TURN hardening and final regression testing before closeout.

### Alpha.5 completed

Alpha.5 is functionally complete and validated.

The next milestone is alpha.6: camera and screen sharing on the existing self-hosted LiveKit transport, including participant video tiles, screen-share publishing, fullscreen/focus UX and quality controls. Internet/NAT traversal hardening remains a deployment task alongside alpha.6 rather than a redesign of the voice layer.

### Alpha.6 video core status

The first alpha.6 slice adds camera publication and participant video grids to the existing
LiveKit transport. The next slice introduces screen sharing and presentation/focus UX,
followed by device/quality controls and final alpha.6 hardening.

### Alpha.6 screen share status

Screen sharing and presentation mode are implemented on the existing LiveKit room. The remaining alpha.6 work is device selection, quality/bitrate controls, responsive/presentation polish and final regression/closeout.

### Alpha.6 device/quality status

Device selection, media quality presets, adaptive delivery and final media UI polish complete the
functional alpha.6 scope. After regression testing, the milestone can move directly to closeout/tag.

### Alpha.6.1 media interaction

A follow-up media UX release adds preflight resolution/FPS selection for camera and screen sharing, clearer browser-dependent shared-audio behavior, and independent per-stream volume controls.

### Alpha.6.1 completed

Alpha.6.1 closes the remaining media-interaction gaps after the alpha.6 media milestone.

Camera and Go Live now use explicit preflight quality selection, shared-audio capability is surfaced clearly, and remote screen-share audio has independent volume control.

The media layer should now be treated as closed for the alpha.6 line. The next product milestone can move to attachments/media messages rather than further transport work.
