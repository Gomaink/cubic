# Channel permission overrides (Alpha 12.3)

`VIEW_CHANNEL` is bit 12. It controls text and voice channel discovery and access independently of `VIEW_SERVER`. Migration 0023 adds it to every existing default role and to the default role trigger (mask 8001), so channels retain their previous visibility until an override changes it. Custom roles remain unchanged. The owner comes only from `servers.owner_user_id` and, while still a member, bypasses all channel overrides.

## Storage and resolution

`server_channel_overrides` has exactly one channel target (text or voice) and exactly one subject (role or member). The implicit default role is targeted by its deterministic ID, equal to the server ID. Composite foreign keys enforce that channel and subject belong to the same server; partial unique indexes allow one override per channel and subject. Deleting a channel, custom role or member cascades to its overrides. The database rejects negative masks, unknown bits and bits present in both `allow` and `deny`. Allowed override bits are `VIEW_CHANNEL`, `SEND_MESSAGES`, `MANAGE_MESSAGES`, `CONNECT`, `SPEAK`, `VIDEO`, and `SCREEN_SHARE` (mask 8128). Server administration bits cannot be overridden.

For a non-owner member, start with the effective server mask (default OR assigned custom role permissions). Then apply stages in this order:

1. Default role channel override: clear denied bits, then set allowed bits.
2. Combine all assigned custom role overrides: OR all denies and OR all allows, then clear denied bits and set allowed bits.
3. Member-specific override: clear denied bits, then set allowed bits.

An allow wins over a deny within the combined role stage. A later stage wins over an earlier one. Missing overrides have zero masks. Unknown stored bits fail closed. An owner bypasses these stages and receives all defined bits. A user without server membership receives no channel authority even if their ID appears in an override.

## Enforcement

`VIEW_CHANNEL` is required before any other channel capability. Text channel lists omit hidden channels. Message reads, sends, reactions and attachment content require visibility; message and attachment creation also require `SEND_MESSAGES`. A hidden or foreign channel returns the existing not-found response. `MANAGE_MESSAGES` is persisted and resolved but has no newly delegated moderation route in this slice; existing own-message edit/delete behavior is unchanged.

Socket.IO initial server text room joins and explicit joins require visibility. Changing an override does not immediately expel a socket already in a text room; server text message events are rechecked for each connected recipient, and a denied recipient is removed from that room before delivery. Voice presence snapshots and events are filtered per recipient. Voice channel lists omit hidden channels.

Server voice ticket issuance requires `VIEW_CHANNEL` and `CONNECT` after locking the server and rechecking membership. The LiveKit token grants only the publish sources allowed by `SPEAK` (microphone), `VIDEO` (camera), and `SCREEN_SHARE` (screen video and audio). A member with `CONNECT` and no publish permissions may join to listen. Periodic reconciliation removes participants who lose visibility or connect permission. Issued tokens expire after 60 seconds; obtaining a new token requires the same server-side authorization again. Expiry does not disconnect a participant who already joined. Immediate revocation of individual publish sources for an already connected participant requires additional LiveKit control-plane updates and is not claimed here.

Overrides belong only to individual text or voice channels. Categories are layout containers and have no inherited permissions in 12.3. Alpha 12.4 can add role/member management UI and override editing against this model; any future category inheritance needs an explicit ordering rule and migration. Channel lists resolve masks with one server authority query and one batched channel/override query per channel kind, avoiding a query per channel or assigned role.

No override write API exists in this slice. A future writer must validate canonical permission names, derive the actor from the session, authorize the server and channel, and lock the server row before changing overrides. The voice ticket path already holds that lock while checking permissions and issuing the token. Direct database writes outside this locking convention are operational changes and cannot provide the same ordering guarantee.
