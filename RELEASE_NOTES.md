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
