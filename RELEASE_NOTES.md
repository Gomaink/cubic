# Cubic v2.0.0-alpha.4 — Groups & Permissions (work in progress)

Alpha.4 starts by proving that groups can reuse the alpha.3 conversation engine instead of creating a second messaging stack.

## Core group slice
- create groups from existing friends
- canonical conversation/message engine reused for groups
- owner/admin/member roles
- group rename
- add/remove members
- owner-only admin promotion/demotion
- ownership transfer
- leave/delete lifecycle
- realtime membership and metadata updates
- member count and group-aware conversation list/header
- group member management UI

## Still planned before alpha.4 closes
- explicit group invite lifecycle
- group avatar through the validated media/storage boundary
- hardening tests for concurrent membership changes

This first alpha.4 slice intentionally requires friendship for adding members and introduces no new database schema: `conversations.kind`, `conversation_members.role` and the existing message model already provide the required core primitives.

## Invite + media hardening slice
- explicit pending/accepted/declined/cancelled group invite lifecycle
- realtime invite notifications to the invitee user room
- invite acceptance joins the existing conversation room without reload
- local media-storage boundary for group avatars (PNG/JPEG/WebP, signature checked, 2 MB default limit)
- authenticated avatar delivery to members and pending invitees
- group avatar metadata in conversation lists and settings
- transaction-scoped PostgreSQL advisory locks around membership/ownership mutations
- group capacity enforcement across active members and pending invitations
- regression tests for media signature/path safety and group mutation locking

This slice adds the first alpha.4 schema migration: `conversations.avatar_key` plus `group_invites`.

## Alpha.4 completion status

Groups & Permissions is validated end to end on the self-hosted Docker deployment.

Validated flows include group creation, realtime group messaging, role changes, ownership transfer, member removal/leave, group invites (accept/decline/cancel), persistent avatar upload/replace/remove, media-volume persistence and mobile/iOS resume behavior.

The alpha.4 schema baseline consists of migration `0002`, which adds `group_invites` and `conversations.avatar_key`.

## Alpha.5 voice core

The first alpha.5 slice adds self-hosted LiveKit/WebRTC voice rooms for existing Cubic conversations. Join credentials are minted only by the authenticated Cubic API after membership checks. Client grants are restricted to microphone publishing in this slice.

Ringing/call history, TURN, camera and screen sharing are intentionally deferred until the core voice transport is validated.

## Alpha.5 ringing and Onyx UI

Direct conversations now have a real call lifecycle before joining LiveKit. The caller sees a calling state, the recipient receives an incoming call, and accept/decline/cancel/end are server-authoritative Socket.IO actions. Group voice remains joinable-room based.

This increment also begins the visual consolidation toward an Onyx-style dark messenger with icon-led controls and fixes desktop message scrolling so the app owns one viewport.

## Alpha.5 history, deafen and Onyx refinement

Conversation history now behaves like a modern messenger: chats open at the latest message, older pages are fetched incrementally near the top without moving the reader's viewport, and new realtime messages do not steal scroll position while history is being read.

Voice now includes Deafen with microphone-state restoration. Group settings and the connected-voice panel receive a second Onyx-oriented visual pass with a flatter hierarchy and local icon controls.

## Alpha.5 persisted calls + message stream

Direct-call lifecycle results now persist in PostgreSQL, including ringing start, answer time,
terminal state and participant join/leave timing. The API exposes authenticated paginated history.

The chat stream is now shared by DMs and groups: messages begin on the left with avatar/name/time,
consecutive messages compact naturally, and date dividers provide visual structure while preserving
the previously validated incremental history and jump-to-latest behavior.

Embedded TURN/UDP configuration is available as an opt-in deployment knob. LAN behavior remains
unchanged by default.

## Alpha.5 completion status

Voice is validated end to end on the self-hosted Cubic stack.

Validated flows include direct and group voice, bidirectional audio, mute/unmute, deafen/undeafen, leave/rejoin, DM ringing lifecycle, accept/decline/cancel/missed/end, mobile reconnect, group switching, persistent call history, incremental message history, jump-to-latest and the unified left-aligned message stream.

The alpha.5 schema baseline includes migration `0003`, adding `calls` and `call_participants`.

TURN/UDP support is present as an opt-in deployment control but remains disabled by default. Internet/NAT traversal validation is intentionally treated as deployment hardening instead of a blocker for the alpha.5 tag.
