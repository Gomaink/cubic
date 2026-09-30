# Changelog

Implemented changes are recorded here. The repository currently reports **`2.0.0-alpha.7`**; the later numbered engineering slices below are work on that development line, not separately published semantic-version releases. Planned work belongs in [ROADMAP.md](ROADMAP.md).

## Unreleased changes on the 2.0.0-alpha.7 line

### Added

- **Alpha 9–10:** independent servers and membership, text channels, categories, server icons, shareable invite links, basic invite cards and persistent audio-only server voice channels. Server text reuses the message layer while server identity remains separate from conversations.
- **Alpha 11 account security:** active-session management, email verification and change, eligible-account password recovery, WebAuthn passkey enrollment, discoverable login, credential management and session-bound reauthentication.
- **Alpha 11 settings:** profile, security, sessions, app and Voice & Video surfaces within User Settings.

### Changed

- Server and channel navigation moved toward the DM/server rail and context-sidebar layout.
- Onyx controls and settings navigation were consolidated without changing the underlying messaging or media authorization model.
- The LiveKit browser client is loaded when media is needed, outside the initial `/app` JavaScript path (Alpha 11.8.3; merge PR #50).

### Fixed

- Svelte baseline warnings were resolved to 0 errors / 0 warnings (merge PR #48).
- Keyboard, dialog focus, forms, media-control semantics, contrast and mobile touch targets were improved (merge PR #49).
- Browser/mobile regression work corrected screen-share keyboard context-menu access and cross-engine test fixtures (merge PR #51).

### Security

- Revocable opaque sessions, sensitive account mutation safeguards, single-use digest-only email/recovery tokens and verified-email policy were reinforced (merge PRs #34–#36).
- Passkey ceremonies use server-authoritative challenges, RP/origin and user-verification checks, credential ownership, replay protection and recent session-bound proof (merge PRs #42–#47).
- Attachment/media authorization, file-type handling and local storage cleanup were hardened during the alpha.7–alpha.8 engineering work.

## 2.0.0-alpha.7 and earlier implemented milestones

### Alpha 7–8 — messaging, media and security hardening

- Added staged attachments, authenticated media delivery, transactional message binding, message actions/replies/reactions, and durable history in DMs and groups.
- Added browser-visible presence, member/profile surfaces and session/realtime hardening. Subsequent hardening addressed attachment storage quotas, cleanup and reconciliation.

### Alpha 6 / 6.1 — video and screen sharing

- Added camera video, participant grid/focus, screen sharing, media preflight, quality and device controls, browser-capability notices and independent remote-stream volume.

### Alpha 5 — voice and history

- Added self-hosted LiveKit voice for direct and group conversations, direct-call ringing lifecycle and persisted call history.
- Added mute/deafen, reconnect handling, cursor-paginated history, jump to latest and the grouped message stream.

### Alpha 4 — groups

- Added group conversations, owner/admin/member administration, group invitations and authenticated persistent group avatars.

### Alpha 3 — social graph and realtime messaging

- Added friends, requests and blocks; canonical direct conversations; persistent messages; authenticated Socket.IO delivery and mobile resume synchronization.

### [2.0.0-alpha.2] — 2026-08-11

- Added PostgreSQL users/settings/sessions, Argon2id, legacy bcrypt upgrade, registration/login/logout, server-side authorization, same-origin API proxy and v1 user import tooling.

### [2.0.0-alpha.1] — 2026-08-11

- Established the Node.js/TypeScript workspaces, SvelteKit web, Fastify API, PostgreSQL/Drizzle, Docker Compose and CI foundation.
