# Channel permission overrides (Alpha 12.4)

`VIEW_CHANNEL` is bit 12. It controls text and voice channel discovery and access independently of `VIEW_SERVER`. Migration 0023 adds it to every existing default role and to the default role trigger (mask 8001), so channels retain their previous visibility until an override changes it. Custom roles remain unchanged. The owner comes only from `servers.owner_user_id` and, while still a member, bypasses all channel overrides.

## Storage and resolution

`server_channel_overrides` has exactly one channel target (text or voice) and exactly one subject (role or member). The implicit default role is targeted by its deterministic ID, equal to the server ID. Composite foreign keys enforce that channel and subject belong to the same server; partial unique indexes allow one override per channel and subject. Deleting a channel, custom role or member cascades to its overrides. The database rejects negative masks, unknown bits and bits present in both `allow` and `deny`. Voice channels retain `VIEW_CHANNEL`, `SEND_MESSAGES`, `MANAGE_MESSAGES`, `CONNECT`, `SPEAK`, `VIDEO`, and `SCREEN_SHARE` (mask 8128). Text channels also accept `MENTION_EVERYONE`, `MENTION_HERE`, and `MENTION_ROLES` (mask 65472). These three bits only configure future structured pings; literal message text does not ping. Server administration bits cannot be overridden.

For a non-owner member, start with the effective server mask (default OR assigned custom role permissions). Then apply stages in this order:

1. Default role channel override: clear denied bits, then set allowed bits.
2. Combine all assigned custom role overrides: OR all denies and OR all allows, then clear denied bits and set allowed bits.
3. Member-specific override: clear denied bits, then set allowed bits.

An allow wins over a deny within the combined role stage. A later stage wins over an earlier one. Missing overrides have zero masks. Unknown stored bits fail closed. An owner bypasses these stages and receives all defined bits. A user without server membership receives no channel authority even if their ID appears in an override.

## Enforcement

`VIEW_CHANNEL` is required before any other channel capability. Text channel lists omit hidden channels. Message reads, sends, reactions and attachment content require visibility; message and attachment creation also require `SEND_MESSAGES`. A hidden or foreign channel returns the existing not-found response. `MANAGE_MESSAGES` is persisted and resolved but has no newly delegated moderation route in this slice; existing own-message edit/delete behavior is unchanged.

Socket.IO initial server text room joins and explicit joins require visibility. Changing an override does not immediately expel a socket already in a text room; server text message events are rechecked for each connected recipient, and a denied recipient is removed from that room before delivery. Voice presence snapshots and events are filtered per recipient. Voice channel lists omit hidden channels.

Server voice ticket issuance requires `VIEW_CHANNEL` and `CONNECT` after locking the server and rechecking membership. The LiveKit token grants only the publish sources allowed by `SPEAK` (microphone), `VIDEO` (camera), and `SCREEN_SHARE` (screen video and audio). A member with `CONNECT` and no publish permissions may join to listen. Reconciliation removes participants who lose visibility or connect permission, and evicts participants whose existing publication grant exceeds the new mask. A gain of publication permission may require a new ticket and reconnect. Issued tokens expire after 60 seconds; obtaining a new token requires the same server-side authorization again. Expiry does not disconnect a participant who already joined.

Overrides belong only to individual text or voice channels. Categories are layout containers and have no inherited permissions in 12.4. Any future category inheritance needs an explicit ordering rule and migration. Channel lists resolve masks with one server authority query and one batched channel/override query per channel kind, avoiding a query per channel or assigned role.

## Management API and editor

Channel Settings has a Permissions editor for members with `MANAGE_CHANNELS`. It lists configured overrides and supports the default `@everyone` role, custom roles, and members. The owner cannot be an individual member target because their channel bypass would make the setting misleading. Each permission has exactly one state: Inherit, Allow, or Deny. Inherit leaves the bit absent from both masks, so the permission comes from the server and earlier override stages. Text channels expose ten permissions; voice channels retain seven.

All routes require an authenticated session and `MANAGE_CHANNELS`:

- `GET /api/v1/servers/:serverId/layout/:kind/:channelId/permissions` returns canonical permission names, overrides, and available role/member targets. `kind` is `text` or `voice`.
- `PUT /api/v1/servers/:serverId/layout/:kind/:channelId/permissions/:targetType/:targetId` replaces the target's entire state with `{ "allow": [...], "deny": [...] }`; empty arrays remove the row. `targetType` is `role` or `member`. The API accepts only distinct canonical names valid for that channel kind, rejects overlap, and never accepts numeric masks.
- `DELETE` at the same target URL removes the row idempotently, normally returning 204.

The API locks the server row in a transaction, recalculates membership and `MANAGE_CHANNELS` after the lock, validates the channel and target in that server, then updates the row. Outsiders and foreign or removed resources receive 404; members without authority receive 403. The owner bypass applies only while they remain a member. `MANAGE_CHANNELS` is server authority: a manager can edit a channel they cannot view, and can grant channel-scoped permissions to themselves or their own role. No role hierarchy is imposed on override editing.

After commit, mutation routes emit `server:layout:changed` with only `serverId`. Browsers refresh visibility and leave a channel that became hidden; realtime message delivery rechecks each recipient. Voice mutations also trigger reconciliation after commit. If voice reconciliation fails, the persisted mutation succeeds with `voiceRevocationPending: true` (including a 200 response for DELETE in that case). A realtime emission failure is logged without changing the persisted outcome. Direct database writes outside this lock convention cannot provide the same ordering guarantee.
