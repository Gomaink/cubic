# Changelog

## 2.0.0-alpha.3

- Added social graph: user search, friend requests, friendships and blocks.
- Added canonical direct conversations and membership authorization.
- Added idempotent message persistence and cursor-ready history.
- Added first usable messenger UI for People, conversations and DMs.
- Added authenticated Socket.IO realtime messaging with per-conversation rooms and reconnect/resync behavior.
- Removed the temporary 2-second message polling path.
- Added same-origin WebSocket proxying while keeping the API unexposed on the host.
- Fixed empty JSON POST handling for social actions.
- Fixed mobile chat navigation, composer/empty-state layout and iOS viewport/background-resume freezes.
- Added local-HTTP UUID fallback for idempotent client message IDs.


All notable changes to Cubic v2 will be documented here.

## [2.0.0-alpha.2] - 2026-08-11

### Added

- Relational `users`, `user_settings` and `sessions` tables.
- Stable `legacy_id` mapping for future MongoDB-to-PostgreSQL migration stages.
- Argon2id password hashing and verification.
- Legacy bcrypt verification with transparent Argon2id upgrade after successful login.
- Register, login, logout, `me` and session-check endpoints.
- Server-authoritative auth guard for protected API routes.
- Random 256-bit session tokens with SHA-256 token digests stored in PostgreSQL.
- HttpOnly + SameSite session cookies with configurable Secure flag and TTL.
- Global rate limiting plus stricter login/register limits.
- Basic response security headers.
- User settings endpoints for theme, compact mode, reduced motion and voice volume preferences.
- Protected `/app` page plus functional SvelteKit login/register UI.
- Same-origin SvelteKit API proxy for browser requests.
- Cubic v1 user/config import CLI.
- Security-focused unit tests.
- `docs/SECURITY.md`.

### Changed

- Cubic version metadata updated to `2.0.0-alpha.2` across all workspaces.
- TypeScript remains on the validated 6.x line for the current Svelte toolchain.
- PostgreSQL 18 persistent volume uses `/var/lib/postgresql`, matching the PostgreSQL 18 container layout.
- Root landing page now reports the identity layer rather than only the foundation stack.
- CI now executes API security unit tests after checks/build.

### Security

- New authenticated writes derive identity exclusively from a resolved server session.
- Session tokens are never persisted in plaintext.
- Login errors do not reveal whether an identifier exists or an account is disabled.
- Password input is bounded and new password hashes use Argon2id.

### Deferred

- Conversation/message authorization and Socket.IO: alpha.3.
- Group management: alpha.4.
- Avatar/file upload pipeline is postponed until a dedicated media-storage boundary is introduced; v2 will not revive the v1 MIME-only upload checks.
- LiveKit voice: alpha.5.

## [2.0.0-alpha.1] - 2026-08-11

### Added

- New TypeScript monorepo foundation.
- Svelte 5 + SvelteKit web application.
- Fastify API with `/api/v1/health` and `/api/v1/ready` endpoints.
- PostgreSQL 18 database service.
- Drizzle ORM schema package and Drizzle Kit commands.
- Docker Compose stack and production Dockerfiles.
- Shared type/version package.
- GitHub Actions CI baseline.
- Architecture, roadmap and v1 migration documentation.
- Responsive foundation status page using Cubic's existing visual assets.

### Changed

- v2 no longer depends on EJS, jQuery, Express, Mongoose or PeerJS at the foundation level.
- TLS is expected to terminate at a reverse proxy rather than inside the Node.js application.

### Intentionally deferred

- Authentication and sessions: alpha.2.
- DMs/groups/message schema and Socket.IO: alpha.3+.
- LiveKit group voice: alpha.5.
- Screen sharing/video: alpha.6.

## v2.0.0-alpha.4

Completed Cubic v2.0.0-alpha.4 Groups & Permissions.

- Added group conversations on top of the alpha.3 conversation engine.
- Added owner/admin/member roles and server-authoritative permission checks.
- Added group rename, membership management and ownership transfer.
- Added realtime group membership updates.
- Added group invite lifecycle: pending, accepted, declined and cancelled.
- Added persistent group avatars with authenticated local media storage.
- Added `group_invites` and `conversations.avatar_key` through migration 0002.
- Added direct streaming proxying for `/api/*` so multipart and future attachments do not pass through the SvelteKit body buffer.
- Added transaction-scoped membership/ownership locking.
- Fixed media-volume ownership for the non-root API runtime.
- Fixed iOS avatar picker/resume behavior and visible upload error handling.
- Verified avatar replacement/removal does not leave orphan files.

## v2.0.0-alpha.5 (in progress)

Alpha.5 voice core slice:
- self-hosted LiveKit SFU service
- server-authoritative voice token endpoint
- conversation membership authorization
- microphone-only publish grants
- direct and group voice rooms
- mute/unmute, leave, participants and active-speaker UI
- mobile secure-context guard and LiveKit reconnect state

### Alpha.5 ringing/call lifecycle slice

- Added authenticated DM call lifecycle over Socket.IO: calling, ringing, accept, decline, cancel, connected and end.
- Added a 45-second unanswered-call timeout.
- Added single-process busy-call coordination and reconnect state sync.
- Kept group voice Discord-like: members join an existing group voice room instead of ringing every member.
- Added an icon-led Onyx-inspired UI pass for navigation, chat actions and voice controls.
- Fixed the messenger viewport regression so message history scrolls inside the message panel instead of the entire page.

### Alpha.5 message history/deafen slice

- Added latest-first conversation opening with incremental older-history loading using the existing message cursor API.
- Preserved scroll position while prepending older pages.
- Added jump-to-latest behavior with a realtime new-message counter when reading older history.
- Added Discord-style Deafen: incoming voice audio is silenced and the microphone is muted, with the previous microphone state restored on undeafen.
- Refined the voice status panel and group settings toward the Onyx visual direction and removed green connection dots.
- Extended the local SVG icon set for voice/history/group-management actions.

### Alpha.5 hardening / message stream
- Persisted direct-call history and participant timing in PostgreSQL.
- Added cursor-paginated authenticated call-history API.
- Added stale active-call recovery after API restart.
- Added opt-in embedded TURN/UDP and external-candidate configuration without changing the validated LAN defaults.
- Reworked DM/group message rendering into one left-aligned Discord-style stream with avatar, sender, timestamp, compact continuations and day separators.

## v2.0.0-alpha.5

Completed Cubic v2.0.0-alpha.5 Voice.

- Added self-hosted LiveKit/WebRTC voice for direct and group conversations.
- Added server-authoritative LiveKit token issuance scoped to authenticated conversation membership.
- Added direct-call lifecycle: calling, ringing, accept, decline, cancel, timeout/missed and end.
- Added group voice rooms with direct join behavior.
- Added mute/unmute, deafen/undeafen, participant presence and active-speaker feedback.
- Added mobile/HTTPS voice support and reconnect handling.
- Added persistent `calls` and `call_participants` data through migration 0003.
- Added call duration, participant join/leave timing and authenticated paginated call-history API.
- Added stale active-call recovery after API restart.
- Added opt-in LiveKit TURN/UDP and external-candidate deployment knobs while preserving the validated LAN defaults.
- Fixed messenger viewport ownership so only message history scrolls.
- Added 50-message cursor pagination, anchored history prepend, open-at-latest behavior and jump-to-latest with new-message count.
- Reworked DM and group message rendering into one left-aligned Discord-style stream with avatar, display name, timestamps, compact continuations and day separators.
- Continued the Onyx-inspired UI pass with flatter surfaces and more icon-led controls.

### Alpha.6 video core
- Enabled LiveKit camera publication while keeping screen sharing denied.
- Added camera on/off controls to the existing voice dock.
- Added responsive participant video tiles for direct and group calls.
- Added camera-off placeholders, active-speaker indication, focus mode and fullscreen stage.
- Added explicit camera cleanup on leave/disconnect.
- Preserved the alpha.5 voice/call/history/message architecture.

### Alpha.6 screen share + presentation
- Enabled LiveKit screen-share video/audio grants.
- Added browser screen/window/tab sharing with optional shared audio.
- Added automatic presentation focus, participant filmstrip, grid return and fullscreen coexistence.
- Added graceful unsupported/cancelled screen-share handling.
- Added automatic cleanup when the browser or user stops sharing.

### Alpha.6 device / quality
- Added live microphone, camera and supported audio-output selection.
- Added persistent camera and screen-share quality presets.
- Enabled Adaptive Stream and Dynacast for new LiveKit rooms.
- Added bitrate/FPS-oriented camera and screen-share profiles.
- Hid the large media stage for audio-only calls.
- Reduced participant duplication between the media stage and floating voice dock.
- Added an Onyx-style Voice & Video settings panel.
